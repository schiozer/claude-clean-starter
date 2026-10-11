type Env = Record<string, string | undefined>

/** Dev local só quando declarado explicitamente; ausente = não é Dev (fail-closed). */
export function isDevEnvironment(env: Env = process.env): boolean {
  return env.APP_ENV === 'development'
}
