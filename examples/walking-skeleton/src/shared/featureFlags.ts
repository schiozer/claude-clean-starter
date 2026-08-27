export function isResourcesEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RESOURCES_ENABLED === 'on'
}
