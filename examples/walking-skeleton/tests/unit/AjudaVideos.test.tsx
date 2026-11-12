import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AjudaVideos } from '@/ui/components/AjudaVideos'

afterEach(cleanup)

const TITULO = 'Criar um recurso e vê-lo na lista'

describe('AjudaVideos', () => {
  it('desligado → não renderiza nada', () => {
    const { container } = render(<AjudaVideos videos={{ estado: 'desligado' }} />)
    expect(container.innerHTML).toBe('')
  })

  it('indisponivel → aviso em role="status"', () => {
    render(<AjudaVideos videos={{ estado: 'indisponivel' }} />)
    expect(screen.getByRole('status').textContent).toBe('Vídeos indisponíveis no momento.')
  })

  it('ok com demo → iframe com título acessível', () => {
    const { container } = render(
      <AjudaVideos
        videos={{
          estado: 'ok',
          demo: {
            versao: 'v1.0.0',
            embedUrl: 'https://iframe.mediadelivery.net/embed/1/a',
            titulo: TITULO,
          },
          treinamento: [],
        }}
      />
    )
    const frames = container.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.getAttribute('title')).toBe(`Demonstração: ${TITULO}`)
    expect(screen.getByRole('heading', { level: 2, name: 'Vídeos' })).toBeTruthy()
  })

  it('ok com treinamento → links que abrem em nova aba com rel seguro', () => {
    render(
      <AjudaVideos
        videos={{
          estado: 'ok',
          demo: null,
          treinamento: [
            {
              id: 'x',
              titulo: 'Primeiros passos',
              embedUrl: 'https://iframe.mediadelivery.net/embed/1/x',
            },
          ],
        }}
      />
    )
    const link = screen.getByRole('link', { name: 'Primeiros passos' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('ok sem demo e sem treinamento → vazio', () => {
    const { container } = render(
      <AjudaVideos videos={{ estado: 'ok', demo: null, treinamento: [] }} />
    )
    expect(container.innerHTML).toBe('')
  })
})
