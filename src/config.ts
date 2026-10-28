export interface Config {
  ethereumUrl: string
  timeoutMs: number
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export const readConfig = (env: Record<string, string | undefined>): Config => {
  const optional = (name: string) => env[name] || undefined
  const required = (name: string) => {
    const value = optional(name)
    if (!value) throw new ConfigError(`${name} is not set`)
    return value
  }
  const positiveInt = (name: string, fallback: number) => {
    const value = Number(env[name] ?? fallback)
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ConfigError(`${name} must be a positive integer`)
    }
    return value
  }
  return {
    ethereumUrl: required('GOLDSKY_ETHEREUM_URL'),
    timeoutMs: positiveInt('UPSTREAM_TIMEOUT_MS', 8000),
  }
}
