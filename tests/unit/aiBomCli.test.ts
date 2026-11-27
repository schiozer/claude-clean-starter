import { describe, it, expect } from 'vitest'
import { main } from '../../scripts/ai-bom.mjs'

function deps(files: Record<string, string>) {
  const out: string[] = []
  const err: string[] = []
  const escritos: Record<string, string> = {}
  return {
    out,
    err,
    escritos,
    deps: {
      cwd: '/proj',
      readFile: (p: string) => (p in escritos ? escritos[p] : p in files ? files[p] : null),
      writeFile: (p: string, c: string) => {
        escritos[p] = c
      },
      list: (dir: string) => {
        const prefix = `${dir}/`
        const nomes = new Set<string>()
        for (const caminho of Object.keys(files)) {
          if (caminho.startsWith(prefix)) nomes.add(caminho.slice(prefix.length).split('/')[0])
        }
        return [...nomes]
      },
      stdout: (t: string) => out.push(t),
      stderr: (t: string) => err.push(t),
    },
  }
}

const files = { '.claude/skills/a/SKILL.md': '---\nname: a\n---\n' }

describe('CLI ai-bom', () => {
  it('sem argumentos grava ai-bom.cdx.json', async () => {
    const d = deps(files)
    expect(await main([], d.deps)).toBe(0)
    expect(JSON.parse(d.escritos['ai-bom.cdx.json']).bomFormat).toBe('CycloneDX')
  })

  it('CT-AIBOM-002 --check com arquivo divergente → exit 1 e orienta', async () => {
    const d = deps({ ...files, 'ai-bom.cdx.json': '{"velho":true}\n' })
    expect(await main(['--check'], d.deps)).toBe(1)
    expect(d.err.join('')).toContain('rode npm run ai-bom')
  })

  it('--check com arquivo igual → exit 0', async () => {
    const d = deps(files)
    await main([], d.deps)
    d.err.length = 0
    expect(await main(['--check'], d.deps)).toBe(0)
    expect(d.err).toEqual([])
  })

  it('CT-AIBOM-011 --check com arquivo ausente → exit 0 com aviso', async () => {
    const d = deps(files)
    expect(await main(['--check'], d.deps)).toBe(0)
    expect(d.err.join('')).toContain('ai-bom.cdx.json')
  })

  it('flag desconhecida → exit 2 com uso', async () => {
    const d = deps(files)
    expect(await main(['--xyz'], d.deps)).toBe(2)
    expect(d.err.join('')).toContain('uso:')
  })

  it('funciona com config ausente e com config desligada', async () => {
    const d = deps({ ...files, 'ai-observabilidade.config.json': '{"ativo":false}' })
    expect(await main([], d.deps)).toBe(0)
  })
})
