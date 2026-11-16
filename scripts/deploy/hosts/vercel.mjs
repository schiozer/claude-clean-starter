// Adaptador Vercel: o deploy é feito pela integração Git da Vercel; aqui tudo é no-op.
// O preview é achado na API de deployments do GitHub (ambiente `Preview*`).

const noop = async () => {}

export default {
  nome: 'vercel',
  ambienteDePreview: (environment) => environment.startsWith('Preview'),
  deployPreview: noop,
  deployProd: noop,
  encerrarPreview: noop,
}
