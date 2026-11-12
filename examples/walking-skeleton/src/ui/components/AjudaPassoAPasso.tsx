'use client'
import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import type { AjudaDocDTO } from '@/modules/ajuda'

/** Tamanho dos screenshots do `docs:gerar` (projeto desktop do Playwright). */
const LARGURA = 1280
const ALTURA = 800

const emCampoDeTexto = (alvo: EventTarget | null): boolean =>
  alvo instanceof HTMLElement &&
  (alvo.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName))

/**
 * `/ajuda/[id]`: um passo por vez (screenshot + legenda), com "Anterior"/"Próximo" e as setas do
 * teclado. Nas pontas o botão fica `aria-disabled` (continua focável: o foco não se perde).
 */
export function AjudaPassoAPasso({ doc }: { doc: AjudaDocDTO }) {
  const [atual, setAtual] = useState(0)
  const total = doc.passos.length
  const passo = doc.passos[atual]
  const temAnterior = atual > 0
  const temProximo = atual < total - 1

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || emCampoDeTexto(e.target)) return
      if (e.key === 'ArrowRight') setAtual((i) => Math.min(i + 1, total - 1))
      if (e.key === 'ArrowLeft') setAtual((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [total])

  return (
    <main>
      <p>
        <Link href="/ajuda" className="ajuda-voltar">
          Voltar para a ajuda
        </Link>
      </p>
      <h1>{doc.titulo}</h1>
      {passo ? (
        <figure className="ajuda-passo">
          {/* `unoptimized`: a imagem vem de uma rota autenticada, não do otimizador público. */}
          <Image
            unoptimized
            src={`/api/ajuda/${doc.id}/imagem/${atual + 1}`}
            alt={`Tela do passo ${atual + 1}: ${passo.texto}`}
            width={LARGURA}
            height={ALTURA}
          />
          <figcaption aria-live="polite">
            <strong>
              Passo {atual + 1} de {total}
            </strong>
            : {passo.texto}
          </figcaption>
        </figure>
      ) : (
        <p>Esta página de ajuda ainda não tem passos.</p>
      )}
      <nav aria-label="Passos" className="ajuda-nav">
        <button
          type="button"
          aria-label="Passo anterior"
          aria-disabled={!temAnterior}
          onClick={() => temAnterior && setAtual(atual - 1)}
        >
          Anterior
        </button>
        <button
          type="button"
          aria-label="Próximo passo"
          aria-disabled={!temProximo}
          onClick={() => temProximo && setAtual(atual + 1)}
        >
          Próximo
        </button>
      </nav>
      <p className="ajuda-dica">Dica: use as setas ← e → do teclado para trocar de passo.</p>
    </main>
  )
}
