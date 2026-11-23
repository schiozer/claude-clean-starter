import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { avisosDoPr, checkPr, parseSpecLine, parseTitle, parseUat } from '../../scripts/pr-gate.mjs'

const ROOT = resolve(__dirname, '../..')
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8')

const UAT = '## UAT\n\n- [ ] UAT aprovado\n- [ ] UAT não se aplica — <motivo>\n'
const SPEC = 'docs/superpowers/specs/x.md'
const bodyWith = (specLine: string, uat = UAT) => `## O quê\n\nx\n\n${specLine}\n\n${uat}`

const run = (
  overrides: Partial<{
    title: string
    body: string
    action: string
    fileExists: (path: string) => boolean
  }> = {}
) =>
  checkPr({
    title: 'feat(release): add gate',
    body: bodyWith(`Spec: ${SPEC}`),
    action: 'edited',
    fileExists: () => true,
    ...overrides,
  })

describe('título', () => {
  it.each(['feat(release): add gate', 'fix: x', 'feat!: x', 'refactor(api)!: x'])(
    'aceita %s',
    (title) => {
      expect(parseTitle(title)).not.toBeNull()
      expect(run({ title })).toEqual([])
    }
  )

  it.each(['Feat: x', 'feature: x', 'feat(API): x', 'feat:x', `fix: ${'a'.repeat(68)}`])(
    'recusa %s',
    (title) => {
      expect(run({ title }).length).toBeGreaterThan(0)
    }
  )

  it('aceita título de exatamente 72 caracteres', () => {
    const title = `fix: ${'a'.repeat(67)}`
    expect(title).toHaveLength(72)
    expect(run({ title })).toEqual([])
  })

  it('recusa título de 73 caracteres', () => {
    const title = `fix: ${'a'.repeat(68)}`
    expect(title).toHaveLength(73)
    expect(run({ title })[0]).toContain('73')
  })

  it('extrai tipo, escopo e breaking', () => {
    expect(parseTitle('feat(a)!: x')).toEqual({ type: 'feat', scope: 'a', breaking: true })
    expect(parseTitle('fix: x')).toEqual({ type: 'fix', scope: null, breaking: false })
  })
})

describe('linha Spec', () => {
  it('sem linha → erro', () => {
    expect(parseSpecLine('nada').kind).toBe('error')
    expect(run({ body: `x\n\n${UAT}` }).length).toBeGreaterThan(0)
  })

  it('duas linhas → erro', () => {
    const body = bodyWith(`Spec: ${SPEC}\nSpec: ${SPEC}`)
    expect(parseSpecLine(body).kind).toBe('error')
    expect(run({ body }).length).toBeGreaterThan(0)
  })

  it('caminho existente → ok; inexistente → erro', () => {
    expect(parseSpecLine(`Spec: ${SPEC}`)).toEqual({ kind: 'path', path: SPEC })
    expect(run({ fileExists: () => true })).toEqual([])
    expect(run({ fileExists: () => false })).toHaveLength(1)
  })

  it.each([
    'docs/adr/x.md',
    'docs/superpowers/specs/_TEMPLATE.md',
    'docs/superpowers/specs/../../x.md',
    'docs/superpowers/specs/x.txt',
    '<caminho ou n/a — motivo>',
  ])('recusa o caminho %s', (path) => {
    expect(run({ body: bodyWith(`Spec: ${path}`) })).toHaveLength(1)
  })

  it.each(['fix', 'docs'])('n/a com motivo em %s → ok', (type) => {
    const body = bodyWith('Spec: n/a — fix do bug #12')
    expect(parseSpecLine(body)).toEqual({ kind: 'na', reason: 'fix do bug #12' })
    expect(run({ title: `${type}: x`, body })).toEqual([])
  })

  it.each(['Spec: n/a —', 'Spec: n/a — <motivo>', 'Spec: n/a'])(
    'motivo vazio → erro (%s)',
    (line) => {
      expect(parseSpecLine(line).kind).toBe('error')
      expect(run({ title: 'fix: x', body: bodyWith(line) })).toHaveLength(1)
    }
  )

  it.each(['feat: x', 'refactor: x', 'fix!: x'])('n/a recusado em %s', (title) => {
    expect(run({ title, body: bodyWith('Spec: n/a — x') })).toHaveLength(1)
  })
})

describe('UAT', () => {
  it('seção ausente → erro', () => {
    expect(parseUat('nada').present).toBe(false)
    expect(run({ body: `Spec: ${SPEC}\n` })).toHaveLength(1)
  })

  it('opened com UAT aprovado marcado → erro', () => {
    const body = bodyWith(
      `Spec: ${SPEC}`,
      '- [x] UAT aprovado\n- [ ] UAT não se aplica — <motivo>\n'
    )
    const errors = run({ action: 'opened', body })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('o UAT é marcado pelo humano depois de testar')
  })

  it('edited com UAT aprovado marcado → ok', () => {
    const body = bodyWith(
      `Spec: ${SPEC}`,
      '- [x] UAT aprovado\n- [ ] UAT não se aplica — <motivo>\n'
    )
    expect(parseUat(body)).toMatchObject({ present: true, approved: true, notApplicable: false })
    expect(run({ action: 'edited', body })).toEqual([])
  })

  it('opened com UAT não se aplica marcado → erro', () => {
    const body = bodyWith(`Spec: ${SPEC}`, '- [ ] UAT aprovado\n- [X] UAT não se aplica — docs\n')
    expect(parseUat(body)).toMatchObject({ notApplicable: true, reason: 'docs' })
    expect(run({ action: 'opened', body })).toHaveLength(1)
  })

  it('UAT aprovado sem diferenciar maiúsculas (como o hook)', () => {
    const body = bodyWith(
      `Spec: ${SPEC}`,
      '- [X] uat Aprovado\n- [ ] UAT não se aplica — <motivo>\n'
    )
    expect(parseUat(body)).toMatchObject({ present: true, approved: true })
    expect(run({ action: 'opened', body })).toHaveLength(1)
  })

  it('as duas opções marcadas → erro (mesma redação da guarda)', () => {
    const body = bodyWith(`Spec: ${SPEC}`, '- [x] UAT aprovado\n- [x] UAT não se aplica — docs\n')
    const errors = run({ action: 'edited', body })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('duas opções de UAT marcadas')
  })

  it('não se aplica marcado sem motivo → erro', () => {
    const body = bodyWith(
      `Spec: ${SPEC}`,
      '- [ ] UAT aprovado\n- [x] UAT não se aplica — <motivo>\n'
    )
    expect(run({ action: 'edited', body })).toHaveLength(1)
  })
})

describe('CRLF', () => {
  it('corpo válido com \\r\\n → sem erros', () => {
    const body = bodyWith(`Spec: ${SPEC}`).replace(/\n/g, '\r\n')
    expect(run({ body })).toEqual([])
  })
})

describe('template de PR', () => {
  const template = read('.github/pull_request_template.md')

  it('só falha na linha Spec (UAT presente e desmarcado)', () => {
    const errors = checkPr({
      title: 'feat(release): add gate',
      body: template,
      action: 'opened',
      fileExists: () => true,
    })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('Spec')
  })

  it.each(['## O quê', '## Por quê', '## Spec × código', '## Checklist', '## UAT'])(
    'contém %s',
    (heading) => {
      expect(template).toContain(heading)
    }
  )
})

describe('workflow pr-gate.yml', () => {
  const workflow = read('.github/workflows/pr-gate.yml')

  it.each([
    'types: [opened, edited, synchronize, reopened]',
    'branches: [main, develop]',
    'name: PR gate',
    'contents: read',
    'ref: ${{ github.event.pull_request.head.sha }}',
    'fetch-depth: 0',
    'run: node scripts/check-cenarios.mjs',
  ])('contém %s', (snippet) => {
    expect(workflow).toContain(snippet)
  })
})

describe('workflow ci.yml', () => {
  it('dispara em PR para main e develop', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci).toMatch(/pull_request:\n\s+branches: \[main, develop\]/)
  })
})

describe('esteira (regras por base)', () => {
  const esteira = {
    integracao: 'develop',
    producao: 'main',
    prefixoHotfix: 'hotfix/',
    promotores: ['fulano'],
  }
  const UAT_NA = '## UAT\n\n- [ ] UAT aprovado\n- [x] UAT não se aplica — correção urgente\n'
  const UAT_OK = '## UAT\n\n- [x] UAT aprovado\n- [ ] UAT não se aplica — <motivo>\n'
  const SEM_UAT = '## O quê\n\nx\n\nSpec: docs/superpowers/specs/x.md\n'
  const gate = (o: Record<string, unknown>) => run({ esteira, action: 'edited', ...o } as never)

  it('sem esteira ignora base/head (como hoje)', () => {
    expect(run({ base: 'main', head: 'feature/x' } as never)).toEqual([])
    expect(run({ base: 'main', head: 'feature/x', body: SEM_UAT } as never)).toHaveLength(1)
  })

  it('base develop + feature não exige UAT', () => {
    expect(gate({ base: 'develop', head: 'feature/x', body: SEM_UAT, title: 'docs: x' })).toEqual(
      []
    )
  })

  it('feature ainda exige título e spec', () => {
    expect(gate({ base: 'develop', head: 'feature/x', title: 'ruim' })).not.toEqual([])
  })

  it('base main + feature/x é inválido', () => {
    expect(gate({ base: 'main', head: 'feature/x' })).toEqual([
      'base main só aceita hotfix/* (ou o FF do Promover para Prod)',
    ])
  })

  it('base develop + hotfix/x é inválido', () => {
    expect(gate({ base: 'develop', head: 'hotfix/x' })).toEqual([
      'base develop não aceita hotfix/* — hotfix vai para main',
    ])
  })

  it('base main + hotfix/x com "não se aplica" ok', () => {
    expect(
      gate({ base: 'main', head: 'hotfix/x', body: bodyWith(`Spec: ${SPEC}`, UAT_NA) })
    ).toEqual([])
  })

  it('hotfix exige a seção UAT', () => {
    expect(gate({ base: 'main', head: 'hotfix/x', body: SEM_UAT })).toHaveLength(1)
  })

  it('hotfix com "UAT aprovado" é erro', () => {
    const errors = gate({
      base: 'main',
      head: 'hotfix/x',
      body: bodyWith(`Spec: ${SPEC}`, UAT_OK),
    })
    expect(errors).toContain('hotfix não passa pelo UAT: use "UAT não se aplica — <motivo>"')
  })

  it('back-promotion main -> develop ok, sem spec nem UAT', () => {
    expect(
      gate({
        base: 'develop',
        head: 'main',
        title: 'chore(release): back-promotion de v1.2.3',
        body: '',
      })
    ).toEqual([])
  })

  it('back-promotion via backpromotion/* também ok', () => {
    expect(
      gate({
        base: 'develop',
        head: 'backpromotion/v1.2.3',
        title: 'chore(release): back-promotion de v1.2.3',
        body: '',
      })
    ).toEqual([])
  })

  it('back-promotion com título errado falha', () => {
    const errors = gate({ base: 'develop', head: 'main', title: 'chore: sync', body: '' })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('chore(release): back-promotion de vX.Y.Z')
  })

  it('base fora da esteira se comporta como hoje', () => {
    expect(gate({ base: 'outra', head: 'feature/x' })).toEqual([])
    expect(gate({ base: 'outra', head: 'feature/x', body: SEM_UAT })).toHaveLength(1)
  })

  describe('avisosDoPr', () => {
    it('avisa merge commit na back-promotion', () => {
      const aviso = 'mergeie com "Create a merge commit", nunca squash'
      expect(avisosDoPr({ base: 'develop', head: 'main', esteira })).toEqual([aviso])
      expect(avisosDoPr({ base: 'develop', head: 'backpromotion/x', esteira })).toEqual([aviso])
    })
    it('sem aviso nos demais casos', () => {
      expect(avisosDoPr({ base: 'develop', head: 'feature/x', esteira })).toEqual([])
      expect(avisosDoPr({ base: 'develop', head: 'main' })).toEqual([])
    })
  })
})
