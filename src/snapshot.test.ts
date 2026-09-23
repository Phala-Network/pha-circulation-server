import {describe, expect, test} from 'bun:test'
import {
  SnapshotDateError,
  findSnapshotBlock,
  parseSnapshotDate,
} from './snapshot.js'

describe('parseSnapshotDate', () => {
  const now = new Date('2026-09-23T12:00:00Z')

  test('returns UTC midnight', () => {
    expect(parseSnapshotDate('2020-04-30', now)).toBe(1588204800n)
    expect(parseSnapshotDate('2026-09-23', now)).toBe(1790121600n)
  })

  test.each(['', '2026-6-24', '2026-02-30', '2026-06-24T00:00:00Z'])(
    'rejects malformed %p',
    (value) => {
      expect(() => parseSnapshotDate(value, now)).toThrow('date')
    },
  )

  test.each(['2020-04-29', '2026-09-24'])(
    'rejects %p outside the supported range without RPC calls',
    (value) => {
      expect(() => parseSnapshotDate(value, now)).toThrow(SnapshotDateError)
    },
  )
})

describe('findSnapshotBlock', () => {
  // Block n has timestamp 100 + 12n, with a gap (missed slots) after block 50.
  const blockAt = async (number: bigint) => ({
    number,
    hash: `0x${'00'.repeat(32)}` as const,
    timestamp: 100n + 12n * number + (number > 50n ? 60n : 0n),
  })
  const find = async (target: bigint, deployment = 0n) =>
    (await findSnapshotBlock(blockAt, target, deployment, await blockAt(1000n)))
      .number

  test('finds the first block at the target timestamp', async () => {
    expect(await find(100n + 12n * 20n)).toBe(20n)
    expect(await find(100n + 12n * 20n - 1n)).toBe(20n)
  })

  test('finds the first block after a gap', async () => {
    // Target falls inside the gap between block 50 (700) and 51 (772).
    expect(await find(710n)).toBe(51n)
  })

  test('uses the deployment block on the deployment day', async () => {
    expect(await find(100n + 12n * 20n, 30n)).toBe(30n)
  })

  test('rejects dates past the finalized block', async () => {
    const finalized = await blockAt(1000n)
    await expect(find(finalized.timestamp + 1n)).rejects.toThrow(
      'not finalized',
    )
  })
})

describe('findSnapshotBlock efficiency', () => {
  // Reference: first block with timestamp >= target, by plain binary search.
  const reference = (
    timestampOf: (n: bigint) => bigint,
    target: bigint,
    last: bigint,
  ) => {
    let low = 0n
    let high = last
    while (low < high) {
      const mid = (low + high) / 2n
      if (timestampOf(mid) >= target) high = mid
      else low = mid + 1n
    }
    return low
  }

  const run = async (
    timestampOf: (n: bigint) => bigint,
    target: bigint,
    last: bigint,
  ) => {
    let calls = 0
    const getBlock = async (number: bigint) => {
      calls++
      return {
        number,
        hash: `0x${'00'.repeat(32)}` as const,
        timestamp: timestampOf(number),
      }
    }
    const found = await findSnapshotBlock(
      getBlock,
      target,
      0n,
      await getBlock(last),
    )
    return {found: found.number, calls}
  }

  test('needs few calls on a 12s chain with missed slots', async () => {
    // Roughly 1% of slots are missed, deterministically spread.
    const timestampOf = (n: bigint) =>
      1_600_000_000n + 12n * n + 12n * ((n * 7919n) / 100_003n)
    const last = 16_000_000n
    for (const offset of [1n, 777_777n, 8_000_000n, 15_999_000n]) {
      const target = timestampOf(offset) - 5n
      const {found, calls} = await run(timestampOf, target, last)
      expect(found).toBe(reference(timestampOf, target, last))
      expect(calls).toBeLessThanOrEqual(12)
    }
  })

  test('stays bounded when interpolation is misleading', async () => {
    // A huge timestamp jump in the middle defeats interpolation.
    const timestampOf = (n: bigint) => (n < 8_000_000n ? n : 10n ** 12n + n)
    const last = 16_000_000n
    const target = 5_000_000n
    const {found, calls} = await run(timestampOf, target, last)
    expect(found).toBe(reference(timestampOf, target, last))
    expect(calls).toBeLessThanOrEqual(2 * 24 + 2)
  })
})
