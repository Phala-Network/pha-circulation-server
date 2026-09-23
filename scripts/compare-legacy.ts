// Verifies snapshots against the legacy squid Snapshot exports: for every
// legacy date, the snapshot block and each stored amount must match exactly.
//
// Usage:
//   ETHEREUM_RPC_URL=... BASE_RPC_URL=... GOLDSKY_VAULT_STATE_URL=... \
//     bun scripts/compare-legacy.ts <ethereum.snapshot.csv> <base.snapshot.csv> \
//     [--every N] [--from YYYY-MM-DD] [--to YYYY-MM-DD]
//
// The CSVs are `\copy (select * from snapshot order by timestamp) to stdout
// with csv header` exports of the legacy databases. --every N checks every Nth
// date to limit RPC usage.

import fs from 'node:fs'
import {parseArgs} from 'node:util'
import {parseUnits} from 'viem'
import {readConfig} from '../src/config'
import {getSnapshot, parseSnapshotDate} from '../src/snapshot'

type Row = Map<string, string>

// One row per date. The exports contain only numbers and timestamps, so a
// plain comma split is sufficient.
const readCsv = (file: string): Map<string, Row> => {
  const [header = '', ...lines] = fs
    .readFileSync(file, 'utf-8')
    .trim()
    .split('\n')
  const columns = header.split(',')
  const rows = new Map<string, Row>()
  for (const line of lines) {
    const values = line.split(',')
    const row: Row = new Map(
      columns.map((column, i) => [column, values[i] ?? '']),
    )
    rows.set((row.get('timestamp') ?? '').slice(0, 10), row)
  }
  return rows
}

// Legacy column -> snapshot field, compared as exact 18-decimal amounts.
const ETHEREUM_FIELDS = {
  reward: 'reward',
  phala_chain_bridge: 'phalaChainBridge',
  khala_chain_bridge: 'khalaChainBridge',
  sygma_bridge: 'sygmaBridge',
  portal_bridge: 'portalBridge',
  total_supply: 'totalSupply',
  circulation: 'circulation',
  vault_reward: 'vaultReward',
}
const BASE_FIELDS = {
  total_supply: 'totalSupply',
  circulation: 'circulation',
}

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    every: {type: 'string'},
    from: {type: 'string'},
    to: {type: 'string'},
  },
})
const [ethereumCsv, baseCsv] = positionals
if (!ethereumCsv || !baseCsv) {
  console.error(
    'Usage: compare-legacy.ts <ethereum.csv> <base.csv> [--every N]',
  )
  process.exit(1)
}

const ethereumRows = readCsv(ethereumCsv)
const baseRows = readCsv(baseCsv)
const every = Number(values.every ?? 1)
const from = values.from ?? '0000-00-00'
const to = values.to ?? '9999-99-99'
const dates = [...ethereumRows.keys()]
  .filter((date) => date >= from && date <= to)
  .filter((_, i, all) => i % every === 0 || i === all.length - 1)

let mismatches = 0
const compare = (
  label: string,
  legacy: Row,
  next: {blockNumber: string; amounts: Record<string, string>},
  fields: Record<string, string>,
) => {
  const diffs: string[] = []
  const legacyBlock = legacy.get('block_height')
  if (legacyBlock !== next.blockNumber) {
    diffs.push(`block ${legacyBlock} != ${next.blockNumber}`)
  }
  for (const [column, field] of Object.entries(fields)) {
    const legacyValue = legacy.get(column) ?? ''
    const nextValue = next.amounts[field] ?? ''
    if (parseUnits(legacyValue, 18) !== parseUnits(nextValue, 18)) {
      diffs.push(`${field} ${legacyValue} != ${nextValue}`)
    }
  }
  mismatches += diffs.length
  return diffs.length > 0
    ? `${label} DIFF ${diffs.join('; ')}`
    : `${label}@${next.blockNumber} ok`
}

const config = readConfig(process.env)
for (const date of dates) {
  const snapshot = await getSnapshot(config, parseSnapshotDate(date))
  const results: string[] = []
  const ethereumLegacy = ethereumRows.get(date)
  if (ethereumLegacy) {
    results.push(
      compare(
        'ethereum',
        ethereumLegacy,
        {
          blockNumber: snapshot.ethereum.blockNumber,
          amounts: snapshot.ethereum,
        },
        ETHEREUM_FIELDS,
      ),
    )
  }
  const baseLegacy = baseRows.get(date)
  if (baseLegacy && snapshot.base) {
    results.push(
      compare(
        'base',
        baseLegacy,
        {blockNumber: snapshot.base.blockNumber, amounts: snapshot.base},
        BASE_FIELDS,
      ),
    )
  } else if (baseLegacy) {
    mismatches++
    results.push('base DIFF missing')
  }
  console.log(date, results.join(' | '))
}

console.log(`\n${dates.length} dates checked, ${mismatches} mismatch(es)`)
if (mismatches > 0) process.exit(1)
