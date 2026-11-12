import type { VideosDaAjuda } from '@/modules/ajuda'

/**
 * Vídeos da página de ajuda: demo da versão (iframe) e lista do treinamento (links).
 * `desligado` e "nada para mostrar" não renderizam; `indisponivel` avisa sem quebrar a página.
 */
export function AjudaVideos({ videos }: { videos: VideosDaAjuda }) {
  if (videos.estado === 'desligado') return null
  if (videos.estado === 'indisponivel') {
    return (
      <p role="status" className="ajuda-aviso">
        Vídeos indisponíveis no momento.
      </p>
    )
  }
  const { demo, treinamento } = videos
  if (!demo && treinamento.length === 0) return null

  return (
    <section aria-labelledby="ajuda-videos-titulo" className="ajuda-videos">
      <h2 id="ajuda-videos-titulo">Vídeos</h2>
      {demo ? (
        <iframe
          title={`Demonstração: ${demo.titulo}`}
          src={demo.embedUrl}
          loading="lazy"
          allow="encrypted-media; picture-in-picture"
          allowFullScreen
        />
      ) : null}
      {treinamento.length > 0 ? (
        <>
          <h3>Treinamento</h3>
          <ul>
            {treinamento.map((v) => (
              <li key={v.id}>
                <a href={v.embedUrl} target="_blank" rel="noopener noreferrer">
                  {v.titulo}
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  )
}
