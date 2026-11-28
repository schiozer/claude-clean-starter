// Regras de alerta do teto mensal (provisioning de arquivo do Grafana). Só o hub as gera.
// Janela móvel de 30 dias: aproximação do mês civil (PromQL não tem janela de mês civil).

import { ATRIBUTO_PROJETO, METRICA_CUSTO } from './metricas.mjs'

const DATASOURCE = '${DS_PROMETHEUS}'
const PASTA = 'ai-observabilidade'
const JANELA = '30d'
const NOTA_JANELA =
  'Custo acumulado em janela móvel de 30 dias (aproximação do mês civil; o mês civil exato fica na auditoria do Neon).'

/** Escapa um valor de label do PromQL (barra e aspas). */
export function escaparLabel(valor) {
  return valor.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function consulta(projeto) {
  const filtro = projeto === null ? '' : `{${ATRIBUTO_PROJETO}="${escaparLabel(projeto)}"}`
  return `sum(increase(${METRICA_CUSTO}${filtro}[${JANELA}]))`
}

function regra({ uid, titulo, expr, limite, severidade, escopo }) {
  return {
    uid,
    title: titulo,
    condition: 'C',
    data: [
      {
        refId: 'A',
        relativeTimeRange: { from: 600, to: 0 },
        datasourceUid: DATASOURCE,
        model: { refId: 'A', expr, instant: true },
      },
      {
        refId: 'B',
        relativeTimeRange: { from: 600, to: 0 },
        datasourceUid: '__expr__',
        model: { refId: 'B', type: 'reduce', expression: 'A', reducer: 'last' },
      },
      {
        refId: 'C',
        relativeTimeRange: { from: 600, to: 0 },
        datasourceUid: '__expr__',
        // Grafana não tem gte: usa gt (equivalente na prática para valores em moeda).
        model: {
          refId: 'C',
          type: 'threshold',
          expression: 'B',
          conditions: [{ evaluator: { type: 'gt', params: [limite] } }],
        },
      },
    ],
    noDataState: 'OK',
    execErrState: 'Error',
    for: '0s',
    annotations: {
      description: `${titulo}: custo acima de US$ ${limite} (${escopo}). ${NOTA_JANELA}`,
    },
    labels: { severidade, escopo },
  }
}

function regrasDe({ uid, nome, projeto, tetoUsd, avisoPct, escopo }) {
  return [
    regra({
      uid: `${uid}-aviso`,
      titulo: `Aviso de teto de IA: ${nome} (${avisoPct}%)`,
      expr: consulta(projeto),
      limite: Number(((tetoUsd * avisoPct) / 100).toFixed(2)),
      severidade: 'aviso',
      escopo,
    }),
    regra({
      uid: `${uid}-alarme`,
      titulo: `Alarme de teto de IA: ${nome} (100%)`,
      expr: consulta(projeto),
      limite: tetoUsd,
      severidade: 'alarme',
      escopo,
    }),
  ]
}

/**
 * @param {{ teto: { mensalUsd: number, avisoPct: number, porProjetoUsd: Record<string, number> } }} cfg
 */
export function regrasAlerta(cfg) {
  const { mensalUsd, avisoPct, porProjetoUsd } = cfg.teto
  const rules = regrasDe({
    uid: 'teto-total',
    nome: 'total',
    projeto: null,
    tetoUsd: mensalUsd,
    avisoPct,
    escopo: 'total',
  })
  for (const [projeto, tetoUsd] of Object.entries(porProjetoUsd)) {
    rules.push(
      ...regrasDe({
        uid: `teto-${projeto.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 28)}`,
        nome: projeto,
        projeto,
        tetoUsd,
        avisoPct,
        escopo: projeto,
      })
    )
  }
  return {
    apiVersion: 1,
    groups: [{ orgId: 1, name: 'ai-teto', folder: PASTA, interval: '1h', rules }],
  }
}
