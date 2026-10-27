import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  setSystemTime,
  spyOn,
  test,
} from 'bun:test'
import {readFileSync} from 'node:fs'
import {getCache, getEnv} from '@vercel/functions'
import app from '../api/index.js'
import {readConfig} from './config.js'
import {type Chain, readSubgraph} from './subgraph.js'

interface RecordedResponse {
  path: string
  status: number
  contentType: string
  cacheControl: string
  cors: string
  body: string
}
const production: {recordedAt: string; responses: RecordedResponse[]} =
  JSON.parse(
    readFileSync(
      new URL('./fixtures/production.json', import.meta.url),
      'utf8',
    ),
  )
const recorded = (path: string) => {
  const result = production.responses.find((row) => row.path === path)
  if (!result) throw new Error(`Missing recorded endpoint ${path}`)
  return result
}
const current: {
  ethereum: Record<string, string>
  base: Record<string, string>
  sources: {ethereum: {vaultUnstakeLocked: string}}
} = JSON.parse(recorded('/api/all').body)
const config = {
  ethereumUrl: 'https://ethereum.test/gn',
  baseUrl: 'https://base.test/gn',
  timeoutMs: 50,
}
const cache = getCache({namespace: getEnv().VERCEL_DEPLOYMENT_ID ?? 'local'})
const fetchSpy = spyOn(globalThis, 'fetch')
const logSpy = spyOn(console, 'error')
const {GOLDSKY_ETHEREUM_URL, GOLDSKY_BASE_URL} = process.env
const latestCacheControl =
  'public, max-age=60, s-maxage=60, stale-while-revalidate=60'
const snapshotCacheControl = 'public, max-age=3600, s-maxage=86400'
const snapshotPaths = production.responses
  .filter((row) => row.path.startsWith('/api/snapshot') && row.status === 200)
  .map((row) => row.path)

const toWei = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.')
  return BigInt(`${whole}${fraction.padEnd(18, '0')}`).toString()
}

interface MockState extends Record<string, unknown> {
  chain: unknown
  timestamp: unknown
  observedBlockNumber: unknown
  observedBlockTimestamp: unknown
  totalSupply: unknown
  circulation: unknown
  vaultImplementationReviewed: unknown
  khalaLegacyChainBridge: unknown
  khalaChainBridge: unknown
  vaultReward: unknown
}

const stateFor = (chain: Chain, date?: string): MockState => {
  let amounts = current[chain]
  if (date) {
    const snapshot: Record<string, Record<string, string>> = JSON.parse(
      recorded(`/api/snapshot?date=${date}`).body,
    )
    amounts = snapshot[chain] ?? {}
  }
  const timestamp = date
    ? Date.parse(`${date}T00:00:00Z`) / 1000
    : Math.floor(Date.now() / 1000) - 10
  const state: MockState = {
    chain,
    timestamp: String(timestamp),
    observedBlockNumber: '100',
    observedBlockTimestamp: String(timestamp - (date ? 200 : 0)),
    totalSupply: '0',
    reward: '0',
    sunsetReward: '0',
    phalaChainBridge: '0',
    khalaLegacyChainBridge: '0',
    khalaChainBridge: '0',
    sygmaBridge: '0',
    portalBridge: '0',
    vaultReward: '0',
    vaultUnstakeLocked: toWei(current.sources.ethereum.vaultUnstakeLocked),
    circulation: '0',
    vaultImplementationReviewed: true,
  }
  for (const [key, value] of Object.entries(amounts)) {
    if (key !== 'timestamp' && key !== 'blockNumber') state[key] = toWei(value)
  }
  if (date === '2020-04-30') {
    state.totalSupply = '0'
    state.circulation = '0'
    state.observedBlockNumber = '0'
    state.observedBlockTimestamp = '0'
  }
  return state
}

interface GraphData {
  latest: MockState | null
  chainDay?: MockState | null
  _meta: {hasIndexingErrors: boolean; block: {number: number}}
}
const requests: {chain: Chain; date?: string; query: string}[] = []
const respond = (mutate?: (data: GraphData, chain: Chain) => void) => {
  fetchSpy.mockImplementation(async (input, init) => {
    const chain = String(input) === config.ethereumUrl ? 'ethereum' : 'base'
    if (typeof init?.body !== 'string') throw new Error('Expected GraphQL body')
    const payload: {query: string; variables?: {date: string}} = JSON.parse(
      init.body,
    )
    const date = payload.variables?.date
    requests.push({chain, date, query: payload.query})
    const data: GraphData = {
      latest: stateFor(chain),
      ...(date ? {chainDay: stateFor(chain, date)} : {}),
      _meta: {hasIndexingErrors: false, block: {number: 200}},
    }
    mutate?.(data, chain)
    return Response.json({data})
  })
}

beforeEach(async () => {
  setSystemTime(new Date(production.recordedAt))
  Object.assign(process.env, {
    GOLDSKY_ETHEREUM_URL: config.ethereumUrl,
    GOLDSKY_BASE_URL: config.baseUrl,
  })
  await Promise.all([
    cache.delete('latest'),
    ...snapshotPaths.map((path) =>
      cache.delete(`snapshot:${path.split('=')[1]}`),
    ),
  ])
  requests.length = 0
  fetchSpy.mockReset()
  logSpy.mockImplementation(() => {})
  respond()
})
afterEach(() => {
  setSystemTime()
  fetchSpy.mockReset()
  for (const [key, value] of [
    ['GOLDSKY_ETHEREUM_URL', GOLDSKY_ETHEREUM_URL],
    ['GOLDSKY_BASE_URL', GOLDSKY_BASE_URL],
  ]) {
    if (key) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
})
afterAll(() => {
  fetchSpy.mockRestore()
  logSpy.mockRestore()
})

const shape = (value: unknown): unknown => {
  if (value === null) return 'null'
  if (typeof value !== 'object') return typeof value
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, shape(child)]),
  )
}

const checkHeaders = (response: Response, reference: RecordedResponse) => {
  expect(response.status).toBe(reference.status)
  expect(response.headers.get('content-type')).toBe(reference.contentType)
  expect(response.headers.get('access-control-allow-origin')).toBe(
    reference.cors,
  )
}

describe('recorded production contracts', () => {
  test('supply tracker gets identical plain-number bytes; latest requests share the cache', async () => {
    const reference = recorded('/api/circulation')
    const response = await app.request(reference.path)
    checkHeaders(response, reference)
    expect(response.headers.get('cache-control')).toBe(latestCacheControl)
    expect(await response.text()).toBe(reference.body)
    await app.request('/api/all?cache-bust=ignored')
    expect(requests).toHaveLength(2)
    expect(requests.map((row) => row.chain).sort()).toEqual([
      'base',
      'ethereum',
    ])
  })

  test('all key sets and types match, with only the approved source metadata replacement', async () => {
    const response = await app.request('/api/all')
    checkHeaders(response, recorded('/api/all'))
    expect(response.headers.get('cache-control')).toBe(latestCacheControl)
    const actual = await response.json()
    const expected = JSON.parse(recorded('/api/all').body)
    expect(actual.sources.ethereum.indexedAt).toBe(actual.ethereum.timestamp)
    expect(actual.sources.ethereum.lagSeconds).toBe('10')
    expect(actual.sources.base.blockTag).toBe('indexed')
    delete actual.sources.ethereum.indexedAt
    delete actual.sources.ethereum.lagSeconds
    delete expected.sources.ethereum.headBlockNumber
    delete expected.sources.ethereum.lagBlocks
    expect(shape(actual)).toEqual(shape(expected))
    expect(actual.totalCirculation).toBe(expected.totalCirculation)
    expect(actual.phala.circulation).toBe('0')
    expect(actual.khala.circulation).toBe('0')
  })

  test.each(snapshotPaths)(
    'snapshot shape and headers match %s',
    async (path) => {
      const response = await app.request(path)
      checkHeaders(response, recorded(path))
      expect(response.headers.get('cache-control')).toBe(snapshotCacheControl)
      const actual = await response.json()
      const expected = JSON.parse(recorded(path).body)
      expect(shape(actual)).toEqual(shape(expected))
      const date = path.split('=')[1]
      expect(actual.date).toBe(`${date}T00:00:00.000000Z`)
      if (date === '2020-04-30') {
        expect(actual.ethereum.totalSupply).toBe('0')
        expect(actual.ethereum.blockNumber).toBe('0')
        expect(actual.ethereum.timestamp).toBe('1970-01-01T00:00:00.000000Z')
      } else {
        expect(actual.ethereum.circulation).toBe(expected.ethereum.circulation)
        expect(actual.ethereum.timestamp < actual.date).toBe(true)
      }
      expect(actual.base === null).toBe(date < '2024-04-05')
      expect(requests).toHaveLength(actual.base === null ? 1 : 2)
      expect(requests.every((row) => row.date === date)).toBe(true)
      await app.request(`${path}&cache-bust=ignored`)
      expect(requests).toHaveLength(actual.base === null ? 1 : 2)
    },
  )

  test.each([
    '/api/snapshot?date=invalid',
    '/api/snapshot?date=2020-04-29',
    '/api',
    '/api/unknown',
  ])(
    'preserves recorded error response %s without upstream calls',
    async (path) => {
      const response = await app.request(path)
      checkHeaders(response, recorded(path))
      expect(await response.text()).toBe(recorded(path).body)
      if (path.startsWith('/api/snapshot')) {
        expect(response.headers.get('cache-control')).toBe('no-store')
      }
      expect(requests).toHaveLength(0)
    },
  )
})

const endpoints = [
  '/api/circulation',
  '/api/all',
  '/api/snapshot?date=2026-10-26',
]
const unhealthy: [string, (data: GraphData) => void][] = [
  [
    'indexing errors',
    (data) => {
      data._meta.hasIndexingErrors = true
    },
  ],
  [
    'stale Latest',
    (data) => {
      if (data.latest)
        data.latest.timestamp = String(Math.floor(Date.now() / 1000) - 901)
    },
  ],
  [
    'unreviewed implementation',
    (data) => {
      if (data.latest) data.latest.vaultImplementationReviewed = false
    },
  ],
  [
    'missing Latest',
    (data) => {
      data.latest = null
    },
  ],
]
for (const chain of ['ethereum', 'base'] as const) {
  describe(`${chain} failures`, () => {
    for (const [label, mutate] of unhealthy) {
      test.each(endpoints)(
        `${label}: %s returns uncached 503 and can recover`,
        async (path) => {
          respond((data, source) => {
            if (chain === source) mutate(data)
          })
          const response = await app.request(path)
          expect(response.status).toBe(503)
          expect(response.headers.get('cache-control')).toBe('no-store')
          expect(response.headers.get('access-control-allow-origin')).toBe('*')
          expect(response.headers.get('content-type')).toBe(
            recorded(path).contentType,
          )
          expect(await response.text()).toBe(
            path === '/api/circulation'
              ? 'Service Unavailable'
              : path === '/api/all'
                ? '{"error":"circulation_unavailable"}'
                : '{"error":"snapshot_unavailable"}',
          )
          respond()
          expect((await app.request(path)).status).toBe(200)
        },
      )
    }
  })
}

test('accepts exactly 15 minutes old and reports age in seconds', async () => {
  respond((data) => {
    if (data.latest) {
      data.latest.timestamp = String(Math.floor(Date.now() / 1000) - 900)
      data.latest.observedBlockTimestamp = data.latest.timestamp
    }
  })
  const result = await readSubgraph(config, 'ethereum')
  expect(result.lagSeconds).toBe(900n)
})

test('daily implementation flag, missing row, and mismatched date are handled safely', async () => {
  const path = '/api/snapshot?date=2026-10-26'
  respond((data) => {
    if (data.chainDay) data.chainDay.vaultImplementationReviewed = false
  })
  expect((await app.request(path)).status).toBe(503)
  respond((data) => {
    if (data.chainDay) data.chainDay.timestamp = '0'
  })
  expect((await app.request(path)).status).toBe(503)
  respond((data) => {
    data.chainDay = null
  })
  const response = await app.request(path)
  expect(response.status).toBe(404)
  expect(response.headers.get('cache-control')).toBe('no-store')
})

test('merges the two Khala bridges and preserves signed Vault rewards', async () => {
  respond((data, chain) => {
    if (chain === 'ethereum' && data.latest) {
      data.latest.khalaLegacyChainBridge = toWei('2')
      data.latest.khalaChainBridge = toWei('3')
      data.latest.vaultReward = toWei('-1.5')
    }
  })
  const response = await app.request('/api/all')
  const result = await response.json()
  expect(result.ethereum.khalaChainBridge).toBe('5')
  expect(result.ethereum.vaultReward).toBe('-1.5')
})

test.each([
  ['negative balance', 'reward', '-1'],
  ['wrong chain', 'chain', 'base'],
  ['malformed amount', 'circulation', '123.5'],
  ['missing amount', 'totalSupply', undefined],
  ['unindexed observed block', 'observedBlockNumber', '201'],
  ['circulation above supply', 'circulation', toWei('1000000001')],
])('rejects %s', async (_label, field, value) => {
  respond((data) => {
    if (data.latest) data.latest[field] = value
  })
  expect((await app.request('/api/all')).status).toBe(503)
})

for (const path of endpoints) {
  test(`${path} rejects HTTP, GraphQL, invalid JSON and network failures without exposing secrets`, async () => {
    const failures = [
      async () => new Response('provider failure', {status: 502}),
      async () =>
        Response.json({errors: [{message: 'secret-provider-url'}], data: {}}),
      async () => new Response('not json'),
      async () => {
        throw new Error('secret-provider-url')
      },
      async () => {
        throw new DOMException('secret-provider-url', 'TimeoutError')
      },
    ]
    for (const failure of failures) {
      fetchSpy.mockImplementation(failure)
      const response = await app.request(path)
      expect(response.status).toBe(503)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.text()).not.toContain('secret-provider-url')
    }
    expect(JSON.stringify(logSpy.mock.calls)).not.toContain(
      'secret-provider-url',
    )
  })
}

test('configuration only requires the two subgraphs and validates the request timeout', () => {
  expect(
    readConfig({
      GOLDSKY_ETHEREUM_URL: config.ethereumUrl,
      GOLDSKY_BASE_URL: config.baseUrl,
    }),
  ).toEqual({...config, timeoutMs: 8000})
  expect(() => readConfig({})).toThrow('GOLDSKY_ETHEREUM_URL')
  expect(() => readConfig({GOLDSKY_ETHEREUM_URL: config.ethereumUrl})).toThrow(
    'GOLDSKY_BASE_URL',
  )
  expect(() =>
    readConfig({
      GOLDSKY_ETHEREUM_URL: config.ethereumUrl,
      GOLDSKY_BASE_URL: config.baseUrl,
      UPSTREAM_TIMEOUT_MS: '0',
    }),
  ).toThrow('positive integer')
})
