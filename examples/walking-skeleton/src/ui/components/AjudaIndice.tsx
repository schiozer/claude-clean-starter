import Link from 'next/link'
import type { AjudaDocDTO, AjudaResultado } from '@/modules/ajuda'

type Falha = Extract<AjudaResultado<unknown>, { ok: false }>

const FUNCIONAIS = new Set(['UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_ERROR'])

/** Erro da ajuda: funcional em tom de aviso, técnico em tom de alerta (ADR-009). */
export function AjudaAviso({ titulo, resultado }: { titulo: string; resultado: Falha }) {
  const funcional = FUNCIONAIS.has(resultado.code)
  return (
    <main>
      <h1>{titulo}</h1>
      <p role={funcional ? 'status' : 'alert'} className={funcional ? 'aviso' : 'erro'}>
        {resultado.mensagem}
      </p>
    </main>
  )
}

const porContexto = (docs: AjudaDocDTO[]): [string, AjudaDocDTO[]][] => {
  const grupos = new Map<string, AjudaDocDTO[]>()
  for (const doc of docs) grupos.set(doc.contexto, [...(grupos.get(doc.contexto) ?? []), doc])
  return [...grupos.entries()]
}

/** `/ajuda`: as páginas que o ator pode ver, agrupadas por contexto. */
export function AjudaIndice({ resultado }: { resultado: AjudaResultado<AjudaDocDTO[]> }) {
  if (!resultado.ok) return <AjudaAviso titulo="Ajuda" resultado={resultado} />
  const grupos = porContexto(resultado.valor)
  return (
    <main>
      <h1>Ajuda</h1>
      {grupos.length === 0 ? (
        <p>Ainda não há páginas de ajuda por aqui.</p>
      ) : (
        grupos.map(([contexto, docs]) => (
          <section key={contexto} aria-labelledby={`ajuda-${contexto}`}>
            <h2 id={`ajuda-${contexto}`}>{contexto}</h2>
            <ul className="ajuda-lista">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Link href={`/ajuda/${doc.id}`}>{doc.titulo}</Link>
                  {doc.perfil === 'time interno' && <span> (time interno)</span>}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  )
}
