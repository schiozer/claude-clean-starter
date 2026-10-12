type Env = Record<string, string | undefined>

/**
 * Dev local só quando declarado explicitamente; ausente = não é Dev (fail-closed).
 * Build de produção (`NODE_ENV=production`, todo deploy UAT/Prod) nunca é Dev, mesmo que
 * `APP_ENV=development` tenha sido copiado por engano para as variáveis do ambiente.
 */
export function isDevEnvironment(env: Env = process.env): boolean {
  return env.APP_ENV === 'development' && env.NODE_ENV !== 'production'
}
