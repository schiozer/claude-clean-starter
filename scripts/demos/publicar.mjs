#!/usr/bin/env node
// Publica as demos/treinamento de uma versão no Bunny (vídeo + catálogo) e atualiza a Release.
// Segredos só aparecem pelo nome, nunca pelo valor.
import { appendFileSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadIndice } from '../e2e/config.mjs'
import { makeGithubClient } from '../github-api.mjs'
import { makeReleaseApi } from '../release.mjs'
import {
  CAMINHO_INDICE,
  caminhoDaVersao,
  lerIndice,
  makeBunnyStorage,
  montarIndice,
} from './catalogo.mjs'
import {
  CAMINHO_SELECAO,
  grepDe,
  paraItem,
  selecionarCenarios,
  specDaTag,
  tagDoCommit,
} from './selecao.mjs'
import { makeBunnyStreamVideoHost } from './video-host.mjs'

export const CAMINHO_MANIFESTO = '.e2e/demos/manifesto.json'
const MARCADOR = '<!-- demos -->'

/** @typedef {import('./catalogo.mjs').CatalogoVersao} CatalogoVersao */
/** @typedef {import('./catalogo.mjs').CatalogoIndice} CatalogoIndice */

/**
 * @param {{
 *   selecao: import('./selecao.mjs').Selecao,
 *   manifesto: { videos: { id: string, projeto: string, arquivo: string, ok: boolean }[] },
 *   host: import('./video-host.mjs').IVideoHost,
 *   storage: import('./catalogo.mjs').IArmazenamento,
 *   libraryId: string,
 *   agora: Date,
 * }} opts
 * @returns {Promise<{ catalogo: CatalogoVersao, indice: CatalogoIndice }>}
 */
export async function publicarDemos({ selecao, manifesto, host, storage, libraryId, agora }) {
  const gravados = (id) => manifesto.videos.filter((video) => video.id === id && video.ok)
  const faltando = [...selecao.demos, ...selecao.treinamento]
    .map((item) => item.id)
    .filter((id, i, todos) => todos.indexOf(id) === i && gravados(id).length === 0)
  if (faltando.length > 0) throw new Error(`demos: sem vídeo gravado para ${faltando.join(', ')}`)

  const enviar = async (colecao, item) => {
    const videos = {}
    for (const video of gravados(item.id)) {
      if (video.projeto !== 'desktop' && video.projeto !== 'mobile') continue
      const { videoId } = await host.upload({
        colecao,
        titulo: `${item.id} — ${item.titulo} (${video.projeto})`,
        arquivo: video.arquivo,
      })
      videos[video.projeto] = videoId
    }
    return { ...item, videos }
  }

  const demos = []
  if (selecao.demos.length > 0) {
    const { id: colecao } = await host.ensureCollection(selecao.versao)
    for (const item of selecao.demos) demos.push(await enviar(colecao, item))
  }

  return host.replaceCollection('Treinamento', async (colecao) => {
    const treinamento = []
    for (const item of selecao.treinamento) treinamento.push(await enviar(colecao, item))
    /** @type {CatalogoVersao} */
    const catalogo = {
      formato: 1,
      versao: selecao.versao,
      geradoEm: agora.toISOString(),
      libraryId,
      spec: selecao.spec,
      demos,
    }
    await storage.gravar(caminhoDaVersao(selecao.versao), `${JSON.stringify(catalogo, null, 2)}\n`)
    const anterior = lerIndice(await storage.ler(CAMINHO_INDICE))
    const indice = montarIndice({ anterior, versao: catalogo, treinamento, agora })
    await storage.gravar(CAMINHO_INDICE, `${JSON.stringify(indice, null, 2)}\n`)
    return { catalogo, indice }
  })
}

/**
 * @param {CatalogoVersao} catalogo
 * @param {Pick<import('./video-host.mjs').IVideoHost, 'embedUrl'>} host
 */
export function notasDasDemos(catalogo, host) {
  const linhas = catalogo.demos.map((demo) => {
    const videoId = demo.videos.desktop ?? demo.videos.mobile
    return `- [${demo.id} — ${demo.titulo}](${videoId ? host.embedUrl(videoId) : ''})`
  })
  return `${MARCADOR}\n### Demos\n${linhas.length > 0 ? linhas.join('\n') : 'Nenhuma demo nesta versão.'}`
}

/** @param {string} runUrl */
export const avisoDeFalha = (runUrl) =>
  `${MARCADOR}\n### Demos\n⚠️ A publicação das demos falhou ([run](${runUrl})). Rode de novo em Actions → Demos & Treinamento → Run workflow, com a tag.`

/** Substitui do marcador até o fim, ou acrescenta a seção ao final. */
export function comSecaoDeDemos(corpo, secao) {
  const inicio = corpo.indexOf(MARCADOR)
  return inicio === -1 ? `${corpo}\n\n${secao}` : `${corpo.slice(0, inicio)}${secao}`
}

const exigir = (nome) => {
  const valor = process.env[nome]
  if (!valor) throw new Error(`demos: defina ${nome}`)
  return valor
}

const saida = (nome, valor) => {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${nome}=${valor}\n`)
  else process.stdout.write(`${nome}=${valor}\n`)
}

const atualizarRelease = async (client, tag, secao) => {
  const release = await client.call('GET', `/releases/tags/${encodeURIComponent(tag)}`)
  await client.call('PATCH', `/releases/${release.id}`, {
    body: comSecaoDeDemos(release.body ?? '', secao),
  })
}

async function cli(comando) {
  const repository = exigir('GITHUB_REPOSITORY')
  const token = exigir('GITHUB_TOKEN')
  const apiUrl = process.env.GITHUB_API_URL || undefined
  const api = makeReleaseApi({ token, repository, apiUrl })
  const client = makeGithubClient({ token, repository, apiUrl, userAgent: 'demos' })

  if (comando === 'tag') {
    const tag = tagDoCommit(await api.tags(), exigir('HEAD_SHA'))
    if (!tag) process.stdout.write('::warning::commit sem tag vX.Y.Z; nada a publicar\n')
    saida('tag', tag ?? '')
  } else if (comando === 'selecionar') {
    const { versao, spec } = await specDaTag(api, exigir('TAG'))
    const { cenarios } = loadIndice(process.cwd())
    const sel = selecionarCenarios({ cenarios: [...cenarios.values()], spec })
    const selecao = {
      versao,
      spec,
      demos: sel.demos.map(paraItem),
      treinamento: sel.treinamento.map(paraItem),
    }
    mkdirSync(dirname(CAMINHO_SELECAO), { recursive: true })
    writeFileSync(CAMINHO_SELECAO, `${JSON.stringify(selecao, null, 2)}\n`)
    saida('grep', grepDe(selecao))
  } else if (comando === 'publicar') {
    const tag = exigir('TAG')
    const libraryId = exigir('BUNNY_LIBRARY_ID')
    const host = makeBunnyStreamVideoHost({ apiKey: exigir('BUNNY_STREAM_API_KEY'), libraryId })
    const storage = makeBunnyStorage({
      zona: exigir('BUNNY_STORAGE_ZONE'),
      senha: exigir('BUNNY_STORAGE_PASSWORD'),
      host: process.env.BUNNY_STORAGE_HOST || undefined,
    })
    const selecao = JSON.parse(readFileSync(resolve(CAMINHO_SELECAO), 'utf8'))
    const manifesto = JSON.parse(readFileSync(resolve(CAMINHO_MANIFESTO), 'utf8'))
    const { catalogo } = await publicarDemos({
      selecao,
      manifesto,
      host,
      storage,
      libraryId,
      agora: new Date(),
    })
    await atualizarRelease(client, tag, notasDasDemos(catalogo, host))
  } else if (comando === 'aviso') {
    await atualizarRelease(client, exigir('TAG'), avisoDeFalha(exigir('RUN_URL')))
  } else {
    throw new Error(`demos: comando desconhecido '${comando}' (tag|selecionar|publicar|aviso)`)
  }
}

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    await cli(process.argv[2])
  } catch (error) {
    process.stderr.write(
      `demos: erro — ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
