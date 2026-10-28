import {describe, expect, test} from 'bun:test'
import {parseSnapshotDate, SnapshotDateError} from './snapshot.js'

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
    'rejects %p outside the supported range without upstream calls',
    (value) => {
      expect(() => parseSnapshotDate(value, now)).toThrow(SnapshotDateError)
    },
  )
})
