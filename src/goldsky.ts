// Client for the phala-vault-state Goldsky subgraph.

export interface GoldskyConfig {
  url: string
  token?: string
  timeoutMs: number
}

export interface IndexedVaultState {
  vaultUnstakeLocked: bigint
  indexedBlock: {number: bigint; hash: `0x${string}`}
}

// Reads a nested field from untrusted JSON; undefined when any level is missing.
const field = (value: unknown, ...path: string[]): unknown => {
  let current = value
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const parseUint = (value: unknown, name: string): bigint => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value)
  throw new Error(`Goldsky: invalid ${name}`)
}

const parseHash = (value: unknown): `0x${string}` => {
  if (typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)) {
    return value.toLowerCase() as `0x${string}`
  }
  throw new Error('Goldsky: invalid block hash')
}

const request = async (config: GoldskyConfig, query: string) => {
  const res = await fetch(config.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(config.token ? {authorization: `Bearer ${config.token}`} : {}),
    },
    body: JSON.stringify({query}),
    signal: AbortSignal.timeout(config.timeoutMs),
  })
  if (!res.ok) throw new Error(`Goldsky: HTTP ${res.status}`)
  const json: unknown = await res.json()
  if (field(json, 'errors') != null || field(json, 'data') == null) {
    throw new Error('Goldsky: GraphQL error response')
  }
  return field(json, 'data')
}

const parseVaultUnstakeLocked = (data: unknown) =>
  parseUint(field(data, 'vaultState', 'vaultUnstakeLocked'), 'VaultState')

// Latest indexed state together with the block it is valid at.
export const fetchIndexedVaultState = async (
  config: GoldskyConfig,
): Promise<IndexedVaultState> => {
  const data = await request(
    config,
    `{
      vaultState(id: "current") { vaultUnstakeLocked }
      _meta { hasIndexingErrors block { number hash } }
    }`,
  )
  if (field(data, '_meta', 'hasIndexingErrors') !== false) {
    throw new Error('Goldsky: missing _meta or subgraph has indexing errors')
  }
  return {
    vaultUnstakeLocked: parseVaultUnstakeLocked(data),
    indexedBlock: {
      number: parseUint(
        field(data, '_meta', 'block', 'number'),
        '_meta.block.number',
      ),
      hash: parseHash(field(data, '_meta', 'block', 'hash')),
    },
  }
}

// State at a historical block (time-travel query), for daily snapshots.
// Goldsky rejects blocks it has not indexed yet; a null state at an indexed
// block means no Vault event had happened, so nothing was locked.
export const fetchVaultUnstakeLockedAt = async (
  config: GoldskyConfig,
  blockNumber: bigint,
): Promise<bigint> => {
  const data = await request(
    config,
    `{ vaultState(id: "current", block: {number: ${blockNumber}}) { vaultUnstakeLocked } }`,
  )
  if (field(data, 'vaultState') === null) return 0n
  return parseVaultUnstakeLocked(data)
}
