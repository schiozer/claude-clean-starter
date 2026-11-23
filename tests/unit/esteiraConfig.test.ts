import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseEsteira, lerEsteira } from '../../scripts/esteira/config.mjs'

const valido = {
  integracao: 'develop',
  producao: 'main',
  prefixoHotfix: 'hotfix/',
  promotores: ['fulano'],
}

describe('parseEsteira', () => {
  it('sem bloco esteira devolve null', () => {
    expect(parseEsteira(undefined)).toBeNull()
    expect(parseEsteira(null)).toBeNull()
  })

  it('bloco válido devolve o objeto', () => {
    expect(parseEsteira(valido)).toEqual(valido)
  })

  it('promotores vazio ou não-array falha', () => {
    const msg = 'esteira: promotores deve ser uma lista não vazia de logins'
    expect(() => parseEsteira({ ...valido, promotores: [] })).toThrow(msg)
    expect(() => parseEsteira({ ...valido, promotores: 'x' })).toThrow(msg)
    expect(() => parseEsteira({ ...valido, promotores: [''] })).toThrow(msg)
  })

  it('integracao igual a producao falha', () => {
    expect(() => parseEsteira({ ...valido, integracao: 'main' })).toThrow(/esteira: integracao/)
  })

  it.each(['integracao', 'producao', 'prefixoHotfix'])(
    '%s vazio falha nomeando o campo',
    (campo) => {
      expect(() => parseEsteira({ ...valido, [campo]: '' })).toThrow(`esteira: ${campo}`)
    }
  )

  it('bloco que não é objeto falha', () => {
    expect(() => parseEsteira('x')).toThrow(/^esteira:/)
  })
})

describe('lerEsteira', () => {
  const comConfig = (conteudo: unknown, fn: (raiz: string) => void) => {
    const raiz = mkdtempSync(join(tmpdir(), 'esteira-'))
    try {
      mkdirSync(join(raiz, 'hooks/protect-main'), { recursive: true })
      writeFileSync(join(raiz, 'hooks/protect-main/config.json'), JSON.stringify(conteudo))
      fn(raiz)
    } finally {
      rmSync(raiz, { recursive: true, force: true })
    }
  }

  it('lê o bloco do config.json', () => {
    comConfig({ protectedBranches: ['main'], esteira: valido }, (raiz) => {
      expect(lerEsteira(raiz)).toEqual(valido)
    })
  })

  it('sem esteira no config devolve null', () => {
    comConfig({ protectedBranches: ['main'] }, (raiz) => {
      expect(lerEsteira(raiz)).toBeNull()
    })
  })
})
