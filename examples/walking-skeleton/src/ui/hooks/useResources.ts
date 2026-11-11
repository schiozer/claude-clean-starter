'use client'
import { useEffect, useState, useCallback } from 'react'
import { TimeoutError } from '@/shared/errors'
import { fetchWithTimeout } from '@/shared/http/fetchWithTimeout'

export interface ResourceView {
  id: string
  title: string
  ownerId: string
}

/** Funcional = regra de negócio (aviso acionável); técnico = algo quebrou ("tente novamente"). */
export type ErrorKind = 'funcional' | 'tecnico'

export interface ResourcesError {
  kind: ErrorKind
  message: string
}

const FUNCTIONAL_CODES = new Set(['VALIDATION_ERROR', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHORIZED'])
const TIMEOUT_MESSAGE = new TimeoutError().message

interface ApiErrorBody {
  error?: unknown
  code?: unknown
}

async function readBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody
  } catch {
    return {}
  }
}

/** Resposta de erro da API → erro da UI pelo `code` (BEST_PRACTICES: funcional × técnico). */
function fromApiError(body: ApiErrorBody, technicalMessage: string): ResourcesError {
  if (
    typeof body.code === 'string' &&
    FUNCTIONAL_CODES.has(body.code) &&
    typeof body.error === 'string'
  ) {
    return { kind: 'funcional', message: body.error }
  }
  if (body.code === 'TIMEOUT') return { kind: 'tecnico', message: TIMEOUT_MESSAGE }
  return { kind: 'tecnico', message: technicalMessage }
}

function fromThrown(error: unknown, technicalMessage: string): ResourcesError {
  if (error instanceof TimeoutError) return { kind: 'tecnico', message: TIMEOUT_MESSAGE }
  return { kind: 'tecnico', message: technicalMessage }
}

const LOAD_FAILED = 'Não foi possível carregar. Tente novamente.'
const CREATE_FAILED = 'Erro. Tente novamente.'

export function useResources() {
  const [resources, setResources] = useState<ResourceView[]>([])
  const [error, setError] = useState<ResourcesError | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchWithTimeout('/api/resources')
      if (!res.ok) {
        setError(fromApiError(await readBody(res), LOAD_FAILED))
        return
      }
      const page: { items: ResourceView[] } = await res.json()
      setResources(page.items)
      setError(null)
    } catch (thrown) {
      setError(fromThrown(thrown, LOAD_FAILED))
    } finally {
      setLoading(false)
    }
  }, [])

  const create = useCallback(
    async (title: string): Promise<boolean> => {
      try {
        const res = await fetchWithTimeout('/api/resources', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title }),
        })
        if (!res.ok) {
          setError(fromApiError(await readBody(res), CREATE_FAILED))
          return false
        }
      } catch (thrown) {
        setError(fromThrown(thrown, CREATE_FAILED))
        return false
      }
      setError(null)
      await load()
      return true
    },
    [load]
  )

  useEffect(() => {
    void load()
  }, [load])

  return { resources, error, loading, create }
}
