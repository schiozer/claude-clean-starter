// Selftest dos helpers de E2E (sem app, sem navegador): roda no projeto `sistemico` contra um
// índice falso (`__fixtures__/cenarios.config.json` via E2E_CENARIOS_CONFIG). Os títulos NÃO
// começam por ID de cenário, então o `check-cenarios` não os trata como testes de cenário real.
import { test, expect } from '@playwright/test'
import { dado, jornada, registrarGanchoDePasso, rnf, rnfMs, telas, type PassoCtx } from './index'

const FIXTURE = 'tests/e2e/support/__fixtures__/cenarios.config.json'

test.describe('helpers de E2E — selftest', { tag: '@sistemico' }, () => {
  let anterior: { config?: string; prefixo?: string }

  test.beforeEach(() => {
    anterior = { config: process.env.E2E_CENARIOS_CONFIG, prefixo: process.env.E2E_RUN_PREFIX }
    process.env.E2E_CENARIOS_CONFIG = FIXTURE
  })

  test.afterEach(() => {
    const restaurar = (nome: string, valor: string | undefined) => {
      if (valor === undefined) delete process.env[nome]
      else process.env[nome] = valor
    }
    restaurar('E2E_CENARIOS_CONFIG', anterior.config)
    restaurar('E2E_RUN_PREFIX', anterior.prefixo)
  })

  test('jornada executa os passos do cenário na ordem da spec', async () => {
    const ordem: string[] = []
    await jornada('CT-JOR-001', {
      'que abro a lista de "Recursos"': async () => {
        ordem.push('1')
      },
      'crio o recurso "Plano de estudos"': async () => {
        ordem.push('2')
      },
      'vejo "Plano de estudos" na lista': async () => {
        ordem.push('3')
      },
    })
    expect(ordem).toEqual(['1', '2', '3'])
  })

  test('jornada com as chaves fora da ordem da spec falha (mesma regra do check)', async () => {
    await expect(
      jornada('CT-JOR-001', {
        'vejo "Plano de estudos" na lista': async () => {},
        'que abro a lista de "Recursos"': async () => {},
        'crio o recurso "Plano de estudos"': async () => {},
      })
    ).rejects.toThrow('mesmos passos em ordem diferente')
  })

  test('jornada chama o gancho de passo com id, índice e texto da spec', async () => {
    const vistos: Omit<PassoCtx, 'cenario'>[] = []
    const remover = registrarGanchoDePasso(async ({ id, indice, palavra, texto, page }) => {
      vistos.push({ id, indice, palavra, texto, page })
    })
    try {
      await jornada('CT-JOR-001', {
        'que abro a lista de "Recursos"': async () => {},
        'crio o recurso "Plano de estudos"': async () => {},
        'vejo "Plano de estudos" na lista': async () => {},
      })
    } finally {
      remover()
    }
    expect(vistos).toEqual([
      {
        id: 'CT-JOR-001',
        indice: 0,
        palavra: 'Dado',
        texto: 'que abro a lista de "Recursos"',
        page: undefined,
      },
      {
        id: 'CT-JOR-001',
        indice: 1,
        palavra: 'Quando',
        texto: 'crio o recurso "Plano de estudos"',
        page: undefined,
      },
      {
        id: 'CT-JOR-001',
        indice: 2,
        palavra: 'Então',
        texto: 'vejo "Plano de estudos" na lista',
        page: undefined,
      },
    ])
  })

  test('jornada com ID inexistente falha sem executar passo', async () => {
    let executou = false
    await expect(
      jornada('CT-XXX-999', {
        qualquer: async () => {
          executou = true
        },
      })
    ).rejects.toThrow('cenário CT-XXX-999 não encontrado')
    expect(executou).toBe(false)
  })

  test('jornada com chave sobrando falha listando a chave', async () => {
    let executou = false
    await expect(
      jornada('CT-JOR-001', {
        'que abro a lista de "Recursos"': async () => {
          executou = true
        },
        'crio o recurso "Plano de estudos"': async () => {},
        'vejo "Plano de estudos" na lista': async () => {},
        'clico em "Salvar"': async () => {},
      })
    ).rejects.toThrow('sobrando: "clico em "Salvar""')
    expect(executou).toBe(false)
  })

  test('jornada com passo faltando falha listando o passo', async () => {
    await expect(
      jornada('CT-JOR-001', {
        'que abro a lista de "Recursos"': async () => {},
        'crio o recurso "Plano de estudos"': async () => {},
      })
    ).rejects.toThrow('faltando: "vejo "Plano de estudos" na lista"')
  })

  test('dado aplica o prefixo da execução só quando há prefixo', () => {
    delete process.env.E2E_RUN_PREFIX
    expect(dado('Plano de estudos')).toBe('Plano de estudos')
    process.env.E2E_RUN_PREFIX = '4242'
    expect(dado('Plano de estudos')).toBe('Plano de estudos · 4242')
  })

  test('rnf, rnfMs e telas leem o baseline do índice', () => {
    expect(rnf('RNF-TMO-001').requisito).toBe('Timeout da API')
    expect(rnfMs('RNF-TMO-001')).toBe(10_000)
    expect(rnfMs('RNF-SES-001')).toBe(8 * 3_600_000)
    expect(() => rnf('RNF-XXX-999')).toThrow('RNF-XXX-999 não encontrado')
    expect(() => rnfMs('RNF-LAR-001')).toThrow("unidade 'px' não é de tempo")
    expect(telas()).toEqual([
      { rota: '/', nome: 'Início' },
      { rota: '/resources', nome: 'Recursos' },
    ])
  })
})
