import {expect, test} from 'bun:test'
import {formatTimestamp} from './circulation.js'

test('formats block timestamps like the legacy squids', () => {
  expect(formatTimestamp(1782337799n)).toBe('2026-06-24T21:49:59.000000Z')
})
