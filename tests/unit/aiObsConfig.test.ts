import { describe, it, expect } from 'vitest'
import { parseAiObsConfig, papel } from '../../scripts/ai-observabilidade/config.mjs'

describe('parseAiObsConfig', () => {
  it('ausente → desligado com teto padrão', () => {
    const cfg = parseAiObsConfig(null)
    expect(cfg).toEqual({
      ativo: false,
      central: false,
      projeto: null,
      teto: { mensalUsd: 400, avisoPct: 80, porProjetoUsd: {} },
    })
    expect(papel(cfg)).toBe('desligado')
  })

  it('ativo:false → desligado, mesmo com central', () =>
    expect(papel(parseAiObsConfig({ ativo: false, central: true }))).toBe('desligado'))

  it('ativo com projeto → emissor', () =>
    expect(papel(parseAiObsConfig({ ativo: true, projeto: 'ContasMes.ai' }))).toBe('emissor'))

  it.each(['meu projeto', 'Projeção', 'a,b', 'a=b'])(
    'CT-AIBOM-005: projeto inválido (%s) → erro',
    (projeto) =>
      expect(() => parseAiObsConfig({ ativo: true, projeto })).toThrow(/projeto deve usar/)
  )

  it('CT-AIBOM-005: projeto AssistBru.ai é válido', () =>
    expect(parseAiObsConfig({ ativo: true, projeto: 'AssistBru.ai' }).projeto).toBe('AssistBru.ai'))

  it('ativo + central → hub', () =>
    expect(papel(parseAiObsConfig({ ativo: true, projeto: 'hub', central: true }))).toBe('hub'))

  it('CT-AIBOM-005: mensalUsd negativo → erro', () =>
    expect(() => parseAiObsConfig({ teto: { mensalUsd: -10 } })).toThrow(
      /ai-observabilidade\.config\.json: teto\.mensalUsd deve ser um número positivo/
    ))

  it('CT-AIBOM-005: avisoPct fora de 1..99 → erro', () =>
    expect(() => parseAiObsConfig({ teto: { avisoPct: 120 } })).toThrow(
      /avisoPct deve estar entre 1 e 99/
    ))

  it('CT-AIBOM-005: ativo sem projeto → erro', () =>
    expect(() => parseAiObsConfig({ ativo: true })).toThrow(/projeto deve ser um texto não vazio/))

  it('CT-AIBOM-005: porProjetoUsd com valor zero → erro', () =>
    expect(() => parseAiObsConfig({ teto: { porProjetoUsd: { X: 0 } } })).toThrow(
      /porProjetoUsd\.X deve ser um número positivo/
    ))

  it('valores personalizados são preservados', () => {
    const cfg = parseAiObsConfig({
      ativo: true,
      projeto: 'p',
      teto: { mensalUsd: 100, avisoPct: 50, porProjetoUsd: { p: 20 } },
    })
    expect(cfg.teto).toEqual({ mensalUsd: 100, avisoPct: 50, porProjetoUsd: { p: 20 } })
  })
})
