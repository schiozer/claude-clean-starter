'use client'
import { useEffect, useState, useCallback } from 'react'

export interface ResourceView {
  id: string
  title: string
  ownerId: string
}

export function useResources() {
  const [resources, setResources] = useState<ResourceView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/resources')
      if (!res.ok) throw new Error('Falha ao carregar')
      setResources(await res.json())
      setError(null)
    } catch {
      setError('Não foi possível carregar. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }, [])

  const create = useCallback(
    async (title: string) => {
      const res = await fetch('/api/resources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.code === 'VALIDATION_ERROR' ? body.error : 'Erro. Tente novamente.')
        return
      }
      setError(null)
      await load()
    },
    [load]
  )

  useEffect(() => {
    void load()
  }, [load])

  return { resources, error, loading, create }
}
