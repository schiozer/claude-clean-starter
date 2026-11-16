#!/usr/bin/env node
// Fachada (mantida por uma Release): a espera do preview vive em `scripts/deploy/aguardar.mjs`.
// A CLI escreve só `url=<…>` em `$GITHUB_OUTPUT` e usa o predicado da Vercel (`Preview*`).

import { appendFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeGithubClient } from '../github-api.mjs'
import { waitPreview } from '../deploy/aguardar.mjs'

export { waitPreview, DEFAULT_TIMEOUT_MS, DEFAULT_INTERVAL_MS } from '../deploy/aguardar.mjs'

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  try {
    const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_OUTPUT, PREVIEW_SHA } =
      process.env
    if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !PREVIEW_SHA) {
      throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY e PREVIEW_SHA são obrigatórios')
    }
    const api = makeGithubClient({
      token: GITHUB_TOKEN,
      repository: GITHUB_REPOSITORY,
      apiUrl: GITHUB_API_URL,
      userAgent: 'e2e-wait-preview',
    })
    const { url } = await waitPreview({ api, sha: PREVIEW_SHA })
    if (GITHUB_OUTPUT) appendFileSync(GITHUB_OUTPUT, `url=${url}\n`)
    process.stdout.write(`wait-preview: preview pronto em ${url}\n`)
  } catch (error) {
    process.stderr.write(
      `wait-preview: ${error instanceof Error ? error.message : String(error)}\n`
    )
    process.exit(1)
  }
}
