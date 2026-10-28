import {formatTotalCirculation} from './calc.js'
import {formatEthereum, formatTimestamp} from './circulation.js'
import type {Config} from './config.js'
import {readSubgraph} from './subgraph.js'

// First supported snapshot date: the Ethereum token deployment day.
export const FIRST_ETHEREUM_SNAPSHOT_DATE = '2020-04-30'

// The requested date cannot be served: malformed (400) or outside the
// available range (404).
export class SnapshotDateError extends Error {
  override name = 'SnapshotDateError'
  constructor(
    message: string,
    readonly status: 400 | 404,
  ) {
    super(message)
  }
}

// Accepts YYYY-MM-DD between the first Ethereum snapshot date and today (UTC)
// and returns its UTC midnight as a unix timestamp. Checked before upstream I/O.
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

// Values are evaluated at exactly midnight; block metadata is last observed
// at or before that boundary. Circulation is supplied by the Ethereum subgraph.
export const getSnapshot = async (config: Config, target: bigint) => {
  const date = new Date(Number(target) * 1000).toISOString().slice(0, 10)
  const {state: ethereum} = await readSubgraph(config, date)
  if (!ethereum) {
    throw new SnapshotDateError('date is not indexed yet', 404)
  }
  return {
    date: formatTimestamp(target),
    ethereum: {
      blockNumber: ethereum.observedBlockNumber.toString(),
      timestamp: formatTimestamp(ethereum.observedBlockTimestamp),
      ...formatEthereum(ethereum),
    },
    base: null,
    totalCirculation: formatTotalCirculation(ethereum.circulation),
  }
}
