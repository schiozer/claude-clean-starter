import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../..')
const ler = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8')

describe('modelo Dockerfile (Cloud Run)', () => {
  const dockerfile = ler('scripts/deploy/templates/cloudrun/Dockerfile')

  it('usa a saída standalone do Next e a porta 8080', () => {
    expect(dockerfile).toContain('.next/standalone')
    expect(dockerfile).toContain('PORT=8080')
  })

  it('sobe o server.js standalone', () => {
    expect(dockerfile).toContain('CMD ["node", "server.js"]')
  })

  it('escuta em 0.0.0.0 (HOSTNAME)', () => {
    expect(dockerfile).toContain('HOSTNAME=0.0.0.0')
  })

  it('roda como usuário não root, com arquivos do usuário copiados via --chown', () => {
    expect(dockerfile).toMatch(/^USER\s+\S+/m)
    expect(dockerfile).toContain('--chown')
  })

  it('instala as dependências sem rodar scripts (o prepare da raiz precisa de scripts/, ainda não copiado)', () => {
    expect(dockerfile).toMatch(/^RUN npm ci --ignore-scripts/m)
  })
})

describe('modelo .dockerignore (Cloud Run)', () => {
  const dockerignore = ler('scripts/deploy/templates/cloudrun/.dockerignore')

  it('não envia segredos para a imagem', () => {
    expect(dockerignore).toContain('.env*')
  })
})

describe('modelo Procfile (Heroku)', () => {
  it('sobe o app com npm start', () => {
    expect(ler('scripts/deploy/templates/heroku/Procfile').trim()).toBe('web: npm start')
  })
})

describe('modelo app.json (Heroku)', () => {
  const raw = ler('scripts/deploy/templates/heroku/app.json')

  it('é JSON válido', () => {
    expect(() => JSON.parse(raw)).not.toThrow()
  })

  it('não declara nenhuma env com valor (herdam do pipeline)', () => {
    const app = JSON.parse(raw) as { env?: Record<string, { value?: unknown }> }
    for (const env of Object.values(app.env ?? {})) {
      expect(env).not.toHaveProperty('value')
    }
    expect(raw).not.toMatch(/"value"\s*:/)
  })
})
