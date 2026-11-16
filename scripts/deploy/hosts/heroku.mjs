// Adaptador Heroku: deploy via Review Apps / pipeline do Heroku; aqui tudo é no-op.
// O nome do ambiente de preview do Heroku não é documentado: o filtro nunca casa, e a espera
// do preview virá de `aguardarPreview` (Platform API), quando implementada.

const noop = async () => {}

export default {
  nome: 'heroku',
  ambienteDePreview: () => false,
  deployPreview: noop,
  deployProd: noop,
  encerrarPreview: noop,
}
