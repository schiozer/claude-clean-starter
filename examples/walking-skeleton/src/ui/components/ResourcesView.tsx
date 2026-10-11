'use client'
import { useState } from 'react'
import { useResources } from '@/ui/hooks/useResources'
import { createResourceSchema } from '@/modules/resources/schemas'

export function ResourcesView() {
  const { resources, error, loading, create } = useResources()
  const [title, setTitle] = useState('')

  const canSubmit = createResourceSchema.safeParse({ title }).success

  return (
    <main>
      <h1>Resources</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void create(title).then((ok) => {
            if (ok) setTitle('')
          })
        }}
      >
        <label htmlFor="title">Título</label>
        <input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <button type="submit" disabled={!canSubmit}>
          Criar
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {loading ? <p>Carregando…</p> : <ul>{resources.map((r) => <li key={r.id}>{r.title}</li>)}</ul>}
    </main>
  )
}
