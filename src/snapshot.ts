import {formatTotalCirculation} from './calc'
import {
  BASE_PHA_DEPLOYED_AT,
  type BlockRef,
  ETHEREUM_PHA_DEPLOYED_AT,
  VAULT_DEPLOYED_AT,
  getBlockRef,
} from './chain'
import {
  createClients,
  formatBase,
  formatEthereum,
  formatTimestamp,
  goldskyConfig,
  readBase,
  readEthereum,
} from './circulation'
import type {Config} from './config'
import {fetchVaultUnstakeLockedAt} from './goldsky'

// First snapshot dates of the legacy squids: the days the tokens were deployed.
export const FIRST_ETHEREUM_SNAPSHOT_DATE = '2020-04-30'
export const FIRST_BASE_SNAPSHOT_DATE = '2024-04-05'

// The requested date cannot be served: malformed (400) or outside the
// finalized range (404).
export class SnapshotDateError extends Error {
  override name = 'SnapshotDateError'
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message)
  }
}

const utcMidnight = (date: string) =>
  BigInt(Date.parse(`${date}T00:00:00Z`) / 1000)

// Accepts YYYY-MM-DD between the first Ethereum snapshot date and today (UTC)
// and returns its UTC midnight as a unix timestamp. Checked before any RPC call.
export const parseSnapshotDate = (value: string, now = new Date()): bigint => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SnapshotDateError('date must be YYYY-MM-DD', 400)
  }
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new SnapshotDateError('date is not a valid calendar date', 400)
  }
  if (value < FIRST_ETHEREUM_SNAPSHOT_DATE || ms > now.getTime()) {
    throw new SnapshotDateError(
      `date must be between ${FIRST_ETHEREUM_SNAPSHOT_DATE} and today`,
      404,
    )
  }
  return BigInt(ms / 1000)
}

// The block the legacy squids snapshotted for a UTC day: the first block at or
// after midnight, or the token deployment block on the deployment day.
export const findSnapshotBlock = async (
  getBlock: (blockNumber: bigint) => Promise<BlockRef>,
  target: bigint,
  deploymentBlock: bigint,
  finalized: BlockRef,
): Promise<BlockRef> => {
  if (finalized.timestamp < target) {
    throw new SnapshotDateError('date is not finalized yet', 404)
  }
  let low = await getBlock(deploymentBlock)
  if (low.timestamp >= target) return low
  // Invariant: low.timestamp < target <= high.timestamp.
  let high = finalized
  while (high.number - low.number > 1n) {
    const mid = await getBlock((low.number + high.number) / 2n)
    if (mid.timestamp >= target) high = mid
    else low = mid
  }
  return high
}

// Daily snapshot for a UTC date (`target`, from parseSnapshotDate), matching
// the legacy squid Snapshot rows. `base` is null before the Base token existed.
export const getSnapshot = async (config: Config, target: bigint) => {
  const clients = createClients(config)
  const hasBase = target >= utcMidnight(FIRST_BASE_SNAPSHOT_DATE)
  const blockOn = (chain: keyof typeof clients) => (blockNumber: bigint) =>
    getBlockRef(clients[chain], {blockNumber})

  const [ethereumFinalized, baseFinalized] = await Promise.all([
    getBlockRef(clients.ethereum, {blockTag: 'finalized'}),
    hasBase ? getBlockRef(clients.base, {blockTag: 'finalized'}) : null,
  ])
  const [ethereumBlock, baseBlock] = await Promise.all([
    findSnapshotBlock(
      blockOn('ethereum'),
      target,
      ETHEREUM_PHA_DEPLOYED_AT,
      ethereumFinalized,
    ),
    baseFinalized &&
      findSnapshotBlock(
        blockOn('base'),
        target,
        BASE_PHA_DEPLOYED_AT,
        baseFinalized,
      ),
  ])

  const vaultUnstakeLocked =
    ethereumBlock.number < VAULT_DEPLOYED_AT
      ? 0n
      : await fetchVaultUnstakeLockedAt(
          goldskyConfig(config),
          ethereumBlock.number,
        )
  const [ethereum, base] = await Promise.all([
    readEthereum(clients.ethereum, ethereumBlock, vaultUnstakeLocked),
    baseBlock && readBase(clients.base, baseBlock),
  ])

  return {
    date: formatTimestamp(target),
    ethereum: {
      blockNumber: ethereumBlock.number.toString(),
      timestamp: formatTimestamp(ethereumBlock.timestamp),
      ...formatEthereum(ethereum),
    },
    base:
      baseBlock && base
        ? {
            blockNumber: baseBlock.number.toString(),
            timestamp: formatTimestamp(baseBlock.timestamp),
            ...formatBase(base),
          }
        : null,
    totalCirculation: formatTotalCirculation(
      ethereum.circulation,
      base?.circulation ?? 0n,
    ),
  }
}
