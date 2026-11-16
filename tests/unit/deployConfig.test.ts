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

  it('heroku/vercel aceitam bloco extra sem validar', () =>
    expect(parseDeployConfig('{"host":"heroku","heroku":{}}').host).toBe('heroku'))
})
