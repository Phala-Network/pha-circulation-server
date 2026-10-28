import type {Config} from './config.js'
import {utcMidnight} from './date.js'

const AMOUNT_FIELDS = [
  'totalSupply',
  'reward',
  'sunsetReward',
  'phalaChainBridge',
  'khalaLegacyChainBridge',
  'khalaChainBridge',
  'sygmaBridge',
  'portalBridge',
  'vaultReward',
  'vaultUnstakeLocked',
  'circulation',
] as const

export type ChainState = Record<(typeof AMOUNT_FIELDS)[number], bigint> & {
  timestamp: bigint
  observedBlockNumber: bigint
  observedBlockTimestamp: bigint
}

const STATE_FIELDS = `chain timestamp observedBlockNumber observedBlockTimestamp
  vaultImplementationReviewed ${AMOUNT_FIELDS.join(' ')}`
const MAX_AGE_SECONDS = 15n * 60n

export class SubgraphError extends Error {
  override name = 'SubgraphError'
}

// Read only known fields from untrusted JSON; missing fields fail validation.
const field = (value: unknown, ...path: string[]): unknown => {
  let current = value
  for (const key of path) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current)
    )
      return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

const integer = (value: unknown): bigint => {
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value)
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return BigInt(value)
  throw new SubgraphError('Invalid subgraph integer')
}

const uint = (value: unknown): bigint => {
  const parsed = integer(value)
  if (parsed < 0n) throw new SubgraphError('Negative subgraph amount or block')
  return parsed
}

const reviewed = (value: unknown) => {
  if (
    field(value, 'chain') !== 'ethereum' ||
    field(value, 'vaultImplementationReviewed') !== true
  ) {
    throw new SubgraphError('Wrong chain or unreviewed Vault implementation')
  }
}

const parseState = (value: unknown, indexedBlock: bigint): ChainState => {
  reviewed(value)
  const amounts = Object.fromEntries(
    AMOUNT_FIELDS.map((key) => [
      key,
      key === 'vaultReward'
        ? integer(field(value, key))
        : uint(field(value, key)),
    ]),
  ) as Record<(typeof AMOUNT_FIELDS)[number], bigint>
  const result = {
    ...amounts,
    timestamp: uint(field(value, 'timestamp')),
    observedBlockNumber: uint(field(value, 'observedBlockNumber')),
    observedBlockTimestamp: uint(field(value, 'observedBlockTimestamp')),
  }
  if (
    result.circulation > result.totalSupply ||
    result.observedBlockNumber > indexedBlock ||
    result.observedBlockTimestamp > result.timestamp
  ) {
    throw new SubgraphError('Inconsistent subgraph state')
  }
  return result
}

// One query to Ethereum. Daily reads also check current indexer freshness
// and implementation safety, without Graph time-travel queries or RPC calls.
export const readSubgraph = async (config: Config, date?: string) => {
  const query = date
    ? `query Snapshot($date: ID!) {
        latest(id: "current") { chain timestamp vaultImplementationReviewed }
        chainDay(id: $date) { ${STATE_FIELDS} }
        _meta { hasIndexingErrors block { number } }
      }`
    : `{
        latest(id: "current") { ${STATE_FIELDS} }
        _meta { hasIndexingErrors block { number } }
      }`
  let body: unknown
  try {
    const response = await fetch(config.ethereumUrl, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({query, variables: date ? {date} : undefined}),
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    if (!response.ok)
      throw new SubgraphError(`Subgraph HTTP ${response.status}`)
    body = await response.json()
  } catch (error) {
    // Network/JSON errors can include the URL; expose only controlled messages.
    if (error instanceof SubgraphError) throw error
    throw new SubgraphError('Subgraph request failed')
  }
  if (field(body, 'errors') != null)
    throw new SubgraphError('Subgraph GraphQL errors')
  const data = field(body, 'data')
  if (field(data, '_meta', 'hasIndexingErrors') !== false) {
    throw new SubgraphError('Subgraph has indexing errors')
  }
  const indexedBlock = uint(field(data, '_meta', 'block', 'number'))
  const latest = field(data, 'latest')
  reviewed(latest)
  const indexedAt = uint(field(latest, 'timestamp'))
  const age = BigInt(Math.floor(Date.now() / 1000)) - indexedAt
  if (age > MAX_AGE_SECONDS) throw new SubgraphError('Subgraph Latest is stale')
  const rawState = date ? field(data, 'chainDay') : latest
  const state = rawState === null ? null : parseState(rawState, indexedBlock)
  if (date && state && state.timestamp !== utcMidnight(date)) {
    throw new SubgraphError('Subgraph snapshot date differs')
  }
  return {state, indexedAt, lagSeconds: age > 0n ? age : 0n}
}
