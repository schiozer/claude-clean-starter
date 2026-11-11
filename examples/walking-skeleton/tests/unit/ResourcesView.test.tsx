import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ResourcesView } from '@/ui/components/ResourcesView'

const respondeCom = (status: number, body: unknown) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(body, { status }))
  )

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ResourcesView — erro funcional × técnico', () => {
  it('erro funcional (FORBIDDEN) → role="status" com a mensagem da API', async () => {
    respondeCom(403, { error: 'Permissão ausente: resources:read', code: 'FORBIDDEN' })
    render(<ResourcesView />)
    expect((await screen.findByRole('status')).textContent).toBe(
      'Permissão ausente: resources:read'
    )
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('timeout do servidor (504 TIMEOUT) → role="alert" com "demorou demais"', async () => {
    respondeCom(504, { error: 'A operação demorou demais. Tente novamente.', code: 'TIMEOUT' })
    render(<ResourcesView />)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'A operação demorou demais. Tente novamente.'
    )
  })

  it('erro técnico genérico (500) → role="alert" com "tente novamente"', async () => {
    respondeCom(500, { error: 'Erro interno. Tente novamente.', code: 'INTERNAL_ERROR' })
    render(<ResourcesView />)
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Não foi possível carregar. Tente novamente.'
    )
  })
})

describe('ResourcesView — loading', () => {
  it('enquanto a lista carrega → indicador com aria-busy="true"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})))
    render(<ResourcesView />)
    expect((await screen.findByText('Carregando…')).getAttribute('aria-busy')).toBe('true')
  })
})
