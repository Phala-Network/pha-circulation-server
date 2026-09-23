export interface Config {
  goldskyUrl: string
  goldskyToken?: string
  ethereumRpcUrl: string
  baseRpcUrl: string
  maxEthereumLagBlocks: bigint
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
    goldskyUrl: required('GOLDSKY_VAULT_STATE_URL'),
    goldskyToken: optional('GOLDSKY_API_TOKEN'),
    ethereumRpcUrl: required('ETHEREUM_RPC_URL'),
    baseRpcUrl: required('BASE_RPC_URL'),
    // 50 blocks is about 10 minutes on Ethereum.
    maxEthereumLagBlocks: BigInt(positiveInt('MAX_ETHEREUM_LAG_BLOCKS', 50)),
    // Requests are not retried, so /api/all stays within two sequential
    // rounds of this timeout.
    timeoutMs: positiveInt('UPSTREAM_TIMEOUT_MS', 8000),
  }
}
