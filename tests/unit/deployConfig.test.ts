import { describe, it, expect } from 'vitest'
import { parseDeployConfig } from '../../scripts/deploy/config.mjs'

const CFG = {
  host: 'cloudrun',
  cloudrun: {
    region: 'us-east1',
    repository: 'app',
    uat: {
      project: 'app-uat',
      service: 'app',
      wifProvider: 'projects/123/locations/global/workloadIdentityPools/github/providers/github',
      serviceAccount: 'deployer@app-uat.iam.gserviceaccount.com',
    },
    prod: {
      project: 'app-prod',
      service: 'app',
      wifProvider: 'projects/456/locations/global/workloadIdentityPools/github/providers/github',
      serviceAccount: 'deployer@app-prod.iam.gserviceaccount.com',
    },
  },
}

function cfgCom(override: { uat?: Record<string, string> }) {
  return { ...CFG, cloudrun: { ...CFG.cloudrun, uat: { ...CFG.cloudrun.uat, ...override.uat } } }
}

describe('parseDeployConfig', () => {
  it('ausente → vercel', () => expect(parseDeployConfig(null)).toEqual({ host: 'vercel' }))

  it('host desconhecido → erro com os válidos', () =>
    expect(() => parseDeployConfig('{"host":"netlify"}')).toThrow(
      /deploy\.config\.json: host 'netlify' inválido.*vercel, heroku, cloudrun/
    ))

  it('JSON quebrado → erro citando o arquivo', () =>
    expect(() => parseDeployConfig('{')).toThrow(/deploy\.config\.json: JSON inválido/))

  it('cloudrun sem bloco → erro', () =>
    expect(() => parseDeployConfig('{"host":"cloudrun"}')).toThrow(/cloudrun: bloco obrigatório/))

  it('cloudrun com campo vazio → erro com o caminho do campo', () =>
    expect(() =>
      parseDeployConfig(JSON.stringify(cfgCom({ uat: { serviceAccount: '' } })))
    ).toThrow(/cloudrun\.uat\.serviceAccount/))

  it('cloudrun válido → devolve o bloco', () =>
    expect(parseDeployConfig(JSON.stringify(CFG)).cloudrun?.prod.project).toBe('app-prod'))

  it('vercel aceita bloco extra sem validar', () =>
    expect(parseDeployConfig('{"host":"vercel","vercel":{}}').host).toBe('vercel'))

  it.each([
    '{"host":"heroku"}',
    '{"host":"heroku","heroku":{}}',
    '{"host":"heroku","heroku":{"pipelineId":" "}}',
  ])('heroku sem pipelineId → erro (%s)', (texto) =>
    expect(() => parseDeployConfig(texto)).toThrow(
      /deploy\.config\.json: heroku\.pipelineId obrigatório/
    )
  )

  it('heroku com pipelineId é válido', () =>
    expect(parseDeployConfig('{"host":"heroku","heroku":{"pipelineId":"p1"}}').host).toBe('heroku'))
})

describe('parseDeployConfig com esteira (heroku)', () => {
  const ESTEIRA = {
    integracao: 'develop',
    producao: 'main',
    prefixoHotfix: 'hotfix/',
    promotores: ['a'],
  }
  const heroku = (extra: Record<string, unknown>) =>
    JSON.stringify({ host: 'heroku', heroku: { pipelineId: 'p1', ...extra } })

  it('sem esteira → uatApp/prodApp não são exigidos (como hoje)', () => {
    expect(parseDeployConfig(heroku({})).host).toBe('heroku')
    expect(parseDeployConfig(heroku({}), {}).host).toBe('heroku')
    expect(parseDeployConfig(heroku({}), { esteira: null }).host).toBe('heroku')
  })

  it.each([
    [{}, /heroku\.uatApp obrigatório/],
    [{ uatApp: ' ', prodApp: 'app-prod' }, /heroku\.uatApp obrigatório/],
    [{ uatApp: 'app-uat' }, /heroku\.prodApp obrigatório/],
    [{ uatApp: 'app-uat', prodApp: '' }, /heroku\.prodApp obrigatório/],
  ])('com esteira e %j → erro', (extra, erro) =>
    expect(() => parseDeployConfig(heroku(extra), { esteira: ESTEIRA })).toThrow(erro)
  )

  it('com esteira, uatApp e prodApp → válido', () =>
    expect(
      parseDeployConfig(heroku({ uatApp: 'app-uat', prodApp: 'app-prod' }), { esteira: ESTEIRA })
        .heroku
    ).toMatchObject({ uatApp: 'app-uat', prodApp: 'app-prod' }))

  it('com esteira e outro host → as regras do heroku não se aplicam', () =>
    expect(parseDeployConfig(JSON.stringify(CFG), { esteira: ESTEIRA }).host).toBe('cloudrun'))
})

describe('parseDeployConfig com esteira (vercel e cloudrun)', () => {
  const ESTEIRA = {
    integracao: 'develop',
    producao: 'main',
    prefixoHotfix: 'hotfix/',
    promotores: ['a'],
  }
  const vercelCfg = (bloco?: Record<string, unknown>) =>
    JSON.stringify({ host: 'vercel', ...(bloco ? { vercel: bloco } : {}) })

  it('vercel sem esteira → uatAlias/team não são exigidos (como hoje)', () =>
    expect(parseDeployConfig(vercelCfg()).host).toBe('vercel'))

  it.each([
    [undefined, /vercel\.uatAlias obrigatório/],
    [{ team: 't' }, /vercel\.uatAlias obrigatório/],
    [{ uatAlias: ' ', team: 't' }, /vercel\.uatAlias obrigatório/],
    [{ uatAlias: 'uat.app.com' }, /vercel\.team obrigatório/],
    [{ uatAlias: 'uat.app.com', team: '' }, /vercel\.team obrigatório/],
  ])('vercel com esteira e %j → erro', (bloco, erro) =>
    expect(() => parseDeployConfig(vercelCfg(bloco), { esteira: ESTEIRA })).toThrow(erro)
  )

  it('vercel com esteira, uatAlias e team → válido', () =>
    expect(
      parseDeployConfig(vercelCfg({ uatAlias: 'uat.app.com', team: 't' }), { esteira: ESTEIRA })
        .vercel
    ).toMatchObject({ uatAlias: 'uat.app.com', team: 't' }))

  it('cloudrun com esteira: o bloco atual (uat.service etc.) basta', () =>
    expect(parseDeployConfig(JSON.stringify(CFG), { esteira: ESTEIRA }).cloudrun).toEqual(
      CFG.cloudrun
    ))
})
