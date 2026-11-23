#!/usr/bin/env node
// Back-promotion da esteira (spec esteira-build-once-promote §3.2-5..7, CT-ESTEIRA-013): depois de
// um hotfix na produção, abre (ou atualiza) o PR head `producao` → base `integracao`. O humano
// mergeia com merge commit (nunca squash), para a produção seguir ancestral da integração.
// Chamado pelo `back-promotion.yml` com o token da App (PR aberto com o GITHUB_TOKEN não dispara
// os checks obrigatórios). Sem o bloco `esteira`: no-op.

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as esperar } from 'node:timers/promises'
import { makeGithubClient } from '../github-api.mjs'
import { lerEsteira } from './config.mjs'
import { PREFIXO_BACKPROMOTION } from './regras.mjs'

const TAG_SEMVER = /^v\d+\.\d+\.\d+$/
const curto = (sha) => String(sha).slice(0, 7)

/**
 * @typedef {import('./config.mjs').Esteira} Esteira
 * @typedef {{ call: (method: string, path: string, body?: unknown) => Promise<any> }} GithubApi
 */

/** `vX.Y.Z` ou, sem tag (Release pulada), o SHA curto. */
export const tituloDaBackPromotion = ({ tag, sha }) =>
  `chore(release): back-promotion de ${tag ?? curto(sha)}`

/**
 * Corpo nas seções do `.github/pull_request_template.md`. O UAT fica desmarcado: só o humano
 * marca (`[R3]`).
 * @param {{ esteira: Esteira, tag: string | null, sha: string }} args
 */
export function corpoDaBackPromotion({ esteira, tag, sha }) {
  const { producao, integracao } = esteira
  const origem = tag ? `\`${tag}\` (${curto(sha)})` : `\`${curto(sha)}\``
  const semTag = tag
    ? []
    : [
        '',
        `Sem tag vX.Y.Z em ${curto(sha)} (a Release foi pulada): o título usa o SHA. O PR gate`,
        'pede `chore(release): back-promotion de vX.Y.Z`; ajuste o título se houver tag depois.',
      ]
  return [
    '## O quê',
    '',
    `Leva o hotfix ${origem} da \`${producao}\` de volta para a \`${integracao}\`.`,
    '',
    '## Por quê',
    '',
    `Back-promotion obrigatória: a \`${producao}\` precisa continuar ancestral da \`${integracao}\``,
    'para a próxima promoção (spec esteira-build-once-promote §3.2).',
    ...semTag,
    '',
    '**Merge:** use "Create a merge commit", nunca squash (o squash quebra a ancestralidade).',
    `Conflito: resolva numa branch \`${PREFIXO_BACKPROMOTION}*\` criada a partir da`,
    `\`${integracao}\` (merge da \`${producao}\` nela) e atualize este PR.`,
    '',
    'Spec: n/a — back-promotion',
    '',
    '## Spec × código',
    '',
    '| Critério (seção "Critérios de Aceitação" da spec) | Onde é atendido (arquivo/teste) | Status |',
    '| ------------------------------------------------- | ------------------------------- | ------ |',
    '| n/a — back-promotion (sem mudança nova)            | —                               | ok     |',
    '',
    '## Cenários × testes',
    '',
    'n/a — os commits já passaram pelo PR do hotfix.',
    '',
    '## Checklist',
    '',
    '- [ ] Merge com "Create a merge commit" (nunca squash)',
    '',
    '## UAT',
    '',
    '- [ ] UAT aprovado',
    '- [ ] UAT não se aplica — <motivo>',
    '',
  ].join('\n')
}

/**
 * Tag `vX.Y.Z` que aponta para o SHA, ou null.
 * @param {{ paginate: (path: string) => Promise<any[]> }} github
 * @param {string} sha
 */
export async function tagDoSha(github, sha) {
  const tags = await github.paginate('/tags')
  return tags.find((t) => TAG_SEMVER.test(t.name) && t.commit?.sha === sha)?.name ?? null
}

/** PR aberto head `producao` → base `integracao` do próprio repositório (não de fork). */
async function prAberto(github, esteira) {
  const base = encodeURIComponent(esteira.integracao)
  const abertos = await github.call('GET', `/pulls?state=open&base=${base}&per_page=100`)
  return (abertos ?? []).find(
    (pr) =>
      pr.head?.ref === esteira.producao &&
      pr.head?.repo?.full_name &&
      pr.head.repo.full_name === pr.base?.repo?.full_name
  )
}

/** `mergeable` é calculado em segundo plano: começa `null`. Devolve o 1º valor não nulo (ou null). */
async function mergeavel(github, numero, { sleep, tentativas, intervaloMs }) {
  for (let i = 0; i < tentativas; i++) {
    const { mergeable } = (await github.call('GET', `/pulls/${numero}`)) ?? {}
    if (mergeable === true || mergeable === false) return mergeable
    if (i < tentativas - 1) await sleep(intervaloMs)
  }
  return null
}

const comentar = (github, numero, body) =>
  github.call('POST', `/issues/${numero}/comments`, { body })

async function avisarConflito(github, numero, esteira, espera) {
  if ((await mergeavel(github, numero, espera)) !== false) return
  const { producao, integracao } = esteira
  await comentar(
    github,
    numero,
    [
      `Conflito entre \`${producao}\` e \`${integracao}\`: este PR não mergeia sozinho.`,
      '',
      `Resolva numa branch \`${PREFIXO_BACKPROMOTION}<descrição>\` criada a partir da`,
      `\`${integracao}\`: faça o merge da \`${producao}\` nela, resolva os conflitos e abra o PR`,
      `dela para a \`${integracao}\` (merge commit, nunca squash).`,
    ].join('\n')
  )
}

/**
 * CT-ESTEIRA-013: cria o PR de back-promotion ou, se já houver um aberto, atualiza o título e
 * comenta (idempotente: mesmo título → nada muda). Conflito após criar/atualizar → comenta.
 * @param {{
 *   github: GithubApi, esteira: Esteira, tag: string | null, sha: string,
 *   sleep?: (ms: number) => Promise<unknown>, tentativas?: number, intervaloMs?: number,
 *   log?: (msg: string) => void,
 * }} args
 * @returns {Promise<{ numero: number, criado: boolean }>}
 */
export async function abrirBackPromotion({
  github,
  esteira,
  tag,
  sha,
  sleep = (ms) => esperar(ms),
  tentativas = 5,
  intervaloMs = 3000,
  log = () => {},
}) {
  const espera = { sleep, tentativas, intervaloMs }
  const title = tituloDaBackPromotion({ tag, sha })
  const existente = await prAberto(github, esteira)

  if (existente) {
    if (existente.title === title) {
      log(`PR #${existente.number} já está em dia (${title})`)
      return { numero: existente.number, criado: false }
    }
    await github.call('PATCH', `/pulls/${existente.number}`, { title })
    await comentar(
      github,
      existente.number,
      `Novo hotfix na \`${esteira.producao}\`: ${tag ?? curto(sha)} (${curto(sha)}). Título atualizado.`
    )
    log(`PR #${existente.number} atualizado para ${title}`)
    await avisarConflito(github, existente.number, esteira, espera)
    return { numero: existente.number, criado: false }
  }

  const criado = await github.call('POST', '/pulls', {
    title,
    head: esteira.producao,
    base: esteira.integracao,
    body: corpoDaBackPromotion({ esteira, tag, sha }),
  })
  log(`PR #${criado.number} aberto: ${title}`)
  await avisarConflito(github, criado.number, esteira, espera)
  return { numero: criado.number, criado: true }
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  const log = (msg) => process.stdout.write(`back-promotion: ${msg}\n`)
  try {
    const esteira = lerEsteira()
    if (!esteira) {
      process.stdout.write('::warning::Esteira desligada: sem back-promotion.\n')
    } else {
      const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, BACKPROMOTION_SHA } = process.env
      if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !BACKPROMOTION_SHA) {
        throw new Error(
          'back-promotion: GITHUB_TOKEN, GITHUB_REPOSITORY e BACKPROMOTION_SHA são obrigatórios'
        )
      }
      const github = makeGithubClient({
        token: GITHUB_TOKEN,
        repository: GITHUB_REPOSITORY,
        apiUrl: GITHUB_API_URL || undefined,
        userAgent: 'esteira-back-promotion',
      })
      const tag = await tagDoSha(github, BACKPROMOTION_SHA)
      if (!tag) {
        process.stdout.write(
          `::warning::Sem tag vX.Y.Z em ${curto(BACKPROMOTION_SHA)} (Release pulada): título pelo SHA.\n`
        )
      }
      await abrirBackPromotion({ github, esteira, tag, sha: BACKPROMOTION_SHA, log })
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
