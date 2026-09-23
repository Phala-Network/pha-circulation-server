import {afterAll, afterEach, describe, expect, spyOn, test} from 'bun:test'
import {fetchIndexedVaultState} from './goldsky.js'

const config = {url: 'https://goldsky.test/gn', timeoutMs: 1000}
const hash = `0x${'ab'.repeat(32)}` as const
const fetchSpy = spyOn(globalThis, 'fetch')

const respondWith = (body: unknown, status = 200) => {
  fetchSpy.mockImplementation(async () => Response.json(body, {status}))
}

afterEach(() => {
  fetchSpy.mockReset()
})

afterAll(() => {
  fetchSpy.mockRestore()
})

describe('fetchIndexedVaultState', () => {
  test('parses state and indexed block', async () => {
    respondWith({
      data: {
        vaultState: {vaultUnstakeLocked: '48383275952282417636691459'},
        _meta: {hasIndexingErrors: false, block: {number: 25390163, hash}},
      },
    })
    expect(await fetchIndexedVaultState(config)).toEqual({
      vaultUnstakeLocked: 48383275952282417636691459n,
      indexedBlock: {number: 25390163n, hash},
    })
  })

  test.each([
    [
      'missing state',
      {
        data: {
          vaultState: null,
          _meta: {hasIndexingErrors: false, block: {number: 1, hash}},
        },
      },
    ],
    [
      'indexing errors',
      {
        data: {
          vaultState: {vaultUnstakeLocked: '0'},
          _meta: {hasIndexingErrors: true, block: {number: 1, hash}},
        },
      },
    ],
    [
      'negative value',
      {
        data: {
          vaultState: {vaultUnstakeLocked: '-1'},
          _meta: {hasIndexingErrors: false, block: {number: 1, hash}},
        },
      },
    ],
    ['GraphQL errors', {errors: [{message: 'boom'}]}],
  ])('rejects %s', async (_label, body) => {
    respondWith(body)
    await expect(fetchIndexedVaultState(config)).rejects.toThrow()
  })

  test('rejects non-2xx responses', async () => {
    respondWith({}, 502)
    await expect(fetchIndexedVaultState(config)).rejects.toThrow('HTTP 502')
  })
})
