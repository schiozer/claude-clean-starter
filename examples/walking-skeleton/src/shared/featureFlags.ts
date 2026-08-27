export function isResourcesEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.RESOURCES_ENABLED === 'on'
}
