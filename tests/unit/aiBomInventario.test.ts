import { describe, it, expect } from 'vitest'
import { coletar, gerarBom, serializar } from '../../scripts/ai-bom/inventario.mjs'

const SHA = '925afb53776cf1a2b738c6bdbed37b4d4000ef13'

function memFs(files: Record<string, string>) {
  return {
    readFile: (p: string) => (p in files ? files[p] : null),
    list: (dir: string) => {
      const prefix = `${dir}/`
      const nomes = new Set<string>()
      for (const caminho of Object.keys(files)) {
        if (caminho.startsWith(prefix)) nomes.add(caminho.slice(prefix.length).split('/')[0])
      }
      return [...nomes]
    },
  }
}

const settings = JSON.stringify({
  enabledPlugins: {
    'superpowers@claude-plugins-official': true,
    'commit-commands@claude-plugins-official': true,
    'remember@claude-plugins-official': true,
    'off@claude-plugins-official': false,
  },
  hooks: {
    SessionStart: [{ matcher: '', hooks: [{ type: 'command', command: 'hooks/a/run.sh' }] }],
    PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'node hooks/r.mjs' }] }],
  },
})

const baseFiles = {
  '.claude/settings.json': settings,
  '.claude/skills/alfa/SKILL.md': '---\nname: alfa-skill\ndescription: Faz alfa\n---\n# Alfa\n',
  '.claude/skills/beta/SKILL.md': '---\nname: beta\ndescription: Faz beta\n---\n',
  '.github/workflows/spec-gate.yml': `jobs:\n  x:\n    steps:\n      - uses: anthropics/claude-code-action@${SHA} # v1.0.262\n        with:\n          args: |\n            --model \${{ vars.SPEC_GATE_MODEL || 'claude-sonnet-5-5' }}\n`,
}

const gerar = (files: Record<string, string>, cfg = { ativo: false }) =>
  gerarBom(coletar(memFs(files)), cfg)

describe('inventário CycloneDX', () => {
  it('CT-AIBOM-001 inventaria plugins, skills, hooks, action e modelo', () => {
    const bom = gerar(baseFiles)
    expect(bom.bomFormat).toBe('CycloneDX')
    expect(bom.specVersion).toBe('1.6')
    const nomes = bom.components.map((c: { name: string }) => c.name)
    expect(nomes).toContain('superpowers@claude-plugins-official')
    expect(nomes).toContain('commit-commands@claude-plugins-official')
    expect(nomes).toContain('remember@claude-plugins-official')
    expect(nomes).not.toContain('off@claude-plugins-official')
    expect(nomes).toContain('alfa-skill')
    expect(nomes).toContain('beta')
    expect(nomes).toContain('SessionStart:*')
    expect(nomes).toContain('PreToolUse:Read')
    const action = bom.components.find(
      (c: { name: string }) => c.name === 'anthropics/claude-code-action'
    )
    expect(action.version).toBe('v1.0.262')
    expect(action.hashes[0].content).toBe(SHA)
    expect(bom.components).toContainEqual(
      expect.objectContaining({ type: 'machine-learning-model', name: 'claude-sonnet-5-5' })
    )
    const hook = bom.components.find((c: { name: string }) => c.name === 'PreToolUse:Read')
    expect(JSON.stringify(hook.properties)).toContain('node hooks/r.mjs')
  })

  it('CT-AIBOM-003 duas gerações produzem strings idênticas, sem timestamp', () => {
    const a = serializar(gerar(baseFiles))
    const b = serializar(gerar(baseFiles))
    expect(a).toBe(b)
    expect(a.endsWith('\n')).toBe(true)
    expect(a).not.toContain('timestamp')
    expect(JSON.parse(a).serialNumber).toMatch(/^urn:uuid:[0-9a-f-]{36}$/)
  })

  it('serialNumber muda quando o conteúdo muda', () => {
    const outro = { ...baseFiles, '.claude/skills/gama/SKILL.md': '---\nname: gama\n---\n' }
    expect(gerar(outro).serialNumber).not.toBe(gerar(baseFiles).serialNumber)
  })

  it('CT-AIBOM-004 ignora settings.local.json', () => {
    const files = {
      ...baseFiles,
      '.claude/settings.local.json': JSON.stringify({
        model: 'claude-opus-segredo',
        enabledPlugins: { 'pessoal@x': true },
      }),
    }
    const texto = serializar(gerar(files))
    expect(texto).not.toContain('pessoal@x')
    expect(texto).not.toContain('claude-opus-segredo')
  })

  it('settings sem chaves não quebra', () => {
    const bom = gerar({ '.claude/settings.json': '{}' })
    expect(bom.components).toEqual([])
  })

  it('arquivos ausentes não quebram', () => {
    expect(gerar({}).components).toEqual([])
  })

  it('skill sem frontmatter usa o nome da pasta', () => {
    const bom = gerar({ '.claude/skills/solta/SKILL.md': '# sem frontmatter\n' })
    expect(bom.components.map((c: { name: string }) => c.name)).toEqual(['solta'])
  })

  it('action @v1 sem hash fica sem hashes', () => {
    const bom = gerar({
      '.github/workflows/a.yml': '    - uses: anthropics/claude-code-action@v1\n',
    })
    const action = bom.components[0]
    expect(action.version).toBe('v1')
    expect(action.hashes).toBeUndefined()
  })

  it('componentes ordenados por type e name', () => {
    const lista = gerar(baseFiles).components.map((c: { type: string; name: string }) => [
      c.type,
      c.name,
    ])
    const ordenada = [...lista].sort((x, y) => x[0].localeCompare(y[0]) || x[1].localeCompare(y[1]))
    expect(lista).toEqual(ordenada)
  })

  it('ativo:true declara Anthropic API, Grafana Cloud e Neon', () => {
    const bom = gerar(baseFiles, { ativo: true })
    expect(bom.services.map((s: { name: string }) => s.name)).toEqual([
      'Anthropic API',
      'Grafana Cloud',
      'Neon',
    ])
  })

  it('ativo:false só declara Anthropic API quando há action com IA', () => {
    expect(gerar(baseFiles).services.map((s: { name: string }) => s.name)).toEqual([
      'Anthropic API',
    ])
    expect(gerar({}).services).toBeUndefined()
  })
})
