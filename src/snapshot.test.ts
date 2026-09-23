import {describe, expect, test} from 'bun:test'
import {
  SnapshotDateError,
  findSnapshotBlock,
  parseSnapshotDate,
} from './snapshot'

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
