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
import {readSubgraph} from './subgraph.js'

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
  sources: {ethereum: {vaultUnstakeLocked: string}}
} = JSON.parse(recorded('/api/all').body)
const config = {
  ethereumUrl: 'https://ethereum.test/gn',
  timeoutMs: 50,
}
const cache = getCache({namespace: getEnv().VERCEL_DEPLOYMENT_ID ?? 'local'})
const fetchSpy = spyOn(globalThis, 'fetch')
const logSpy = spyOn(console, 'error')
const ethereumEnvKey = 'GOLDSKY_ETHEREUM_URL'
const originalEthereumUrl = process.env[ethereumEnvKey]
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

const stateFor = (date?: string): MockState => {
  let amounts = current.ethereum
  if (date) {
    const snapshot: {ethereum: Record<string, string>} = JSON.parse(
      recorded(`/api/snapshot?date=${date}`).body,
    )
    amounts = snapshot.ethereum
  }
  const timestamp = date
    ? Date.parse(`${date}T00:00:00Z`) / 1000
    : Math.floor(Date.now() / 1000) - 10
  const state: MockState = {
    chain: 'ethereum',
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
  // The new subgraph includes the Portal escrow in Ethereum circulation.
  const {circulation = '0', portalBridge = '0'} = amounts
  state.circulation = (
    BigInt(toWei(circulation)) + BigInt(toWei(portalBridge))
  ).toString()
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
const requests: {url: string; date?: string; query: string}[] = []
const respond = (mutate?: (data: GraphData) => void) => {
  fetchSpy.mockImplementation(async (input, init) => {
    const url = String(input)
    if (url !== config.ethereumUrl) throw new Error('Unexpected upstream URL')
    if (typeof init?.body !== 'string') throw new Error('Expected GraphQL body')
    const payload: {query: string; variables?: {date: string}} = JSON.parse(
      init.body,
    )
    const date = payload.variables?.date
    requests.push({url, date, query: payload.query})
    const data: GraphData = {
      latest: stateFor(),
      ...(date ? {chainDay: stateFor(date)} : {}),
      _meta: {hasIndexingErrors: false, block: {number: 200}},
    }
    mutate?.(data)
    return Response.json({data})
  })
}

beforeEach(async () => {
  setSystemTime(new Date(production.recordedAt))
  Object.assign(process.env, {
    GOLDSKY_ETHEREUM_URL: config.ethereumUrl,
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
  if (originalEthereumUrl === undefined) delete process.env[ethereumEnvKey]
  else process.env[ethereumEnvKey] = originalEthereumUrl
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
  test('supply tracker keeps plain-number formatting and includes Portal escrow; latest requests share the cache', async () => {
    const reference = recorded('/api/circulation')
    const response = await app.request(reference.path)
    checkHeaders(response, reference)
    expect(response.headers.get('cache-control')).toBe(latestCacheControl)
    expect(await response.text()).toBe('858569518.416145188511')
    await app.request('/api/all?cache-bust=ignored')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(config.ethereumUrl)
  })

  test('all keys/types match apart from null Base and the approved source metadata replacement', async () => {
    const response = await app.request('/api/all')
    checkHeaders(response, recorded('/api/all'))
    expect(response.headers.get('cache-control')).toBe(latestCacheControl)
    const actual = await response.json()
    const expected = JSON.parse(recorded('/api/all').body)
    expect(actual.sources.ethereum.indexedAt).toBe(actual.ethereum.timestamp)
    expect(actual.sources.ethereum.lagSeconds).toBe('10')
    expect(actual.base).toBeNull()
    expect(actual.sources.base).toBeNull()
    expected.base = null
    expected.sources.base = null
    delete actual.sources.ethereum.indexedAt
    delete actual.sources.ethereum.lagSeconds
    delete expected.sources.ethereum.headBlockNumber
    delete expected.sources.ethereum.lagBlocks
    expect(shape(actual)).toEqual(shape(expected))
    expect(actual.ethereum.circulation).toBe('858569518.416145188511489765')
    expect(actual.totalCirculation).toBe('858569518.416145188511')
    expect(actual.ethereum.portalBridge).toBe(expected.ethereum.portalBridge)
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
      expected.base = null
      expect(shape(actual)).toEqual(shape(expected))
      const date = path.split('=')[1]
      expect(actual.date).toBe(`${date}T00:00:00.000000Z`)
      if (date === '2020-04-30') {
        expect(actual.ethereum.totalSupply).toBe('0')
        expect(actual.ethereum.blockNumber).toBe('0')
        expect(actual.ethereum.timestamp).toBe('1970-01-01T00:00:00.000000Z')
      } else {
        expect(toWei(actual.ethereum.circulation)).toBe(
          (
            BigInt(toWei(expected.ethereum.circulation)) +
            BigInt(toWei(expected.ethereum.portalBridge))
          ).toString(),
        )
        expect(actual.ethereum.portalBridge).toBe(
          expected.ethereum.portalBridge,
        )
        expect(actual.ethereum.timestamp < actual.date).toBe(true)
      }
      expect(actual.totalCirculation).toBe(
        date === '2026-10-26'
          ? '858488273.448493821323'
          : date === '2020-04-30'
            ? '0'
            : expected.totalCirculation,
      )
      expect(actual.base).toBeNull()
      expect(requests).toHaveLength(1)
      expect(requests.every((row) => row.date === date)).toBe(true)
      await app.request(`${path}&cache-bust=ignored`)
      expect(requests).toHaveLength(1)
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
describe('subgraph failures', () => {
  for (const [label, mutate] of unhealthy) {
    test.each(endpoints)(
      `${label}: %s returns uncached 503 and can recover`,
      async (path) => {
        respond(mutate)
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

test('accepts exactly 15 minutes old and reports age in seconds', async () => {
  respond((data) => {
    if (data.latest) {
      data.latest.timestamp = String(Math.floor(Date.now() / 1000) - 900)
      data.latest.observedBlockTimestamp = data.latest.timestamp
    }
  })
  const result = await readSubgraph(config)
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
  respond((data) => {
    if (data.latest) {
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
  ['wrong chain', 'chain', 'unexpected'],
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

test('configuration only requires the Ethereum subgraph and validates the request timeout', () => {
  expect(
    readConfig({
      GOLDSKY_ETHEREUM_URL: config.ethereumUrl,
    }),
  ).toEqual({...config, timeoutMs: 8000})
  expect(() => readConfig({})).toThrow('GOLDSKY_ETHEREUM_URL')
  expect(() =>
    readConfig({
      GOLDSKY_ETHEREUM_URL: config.ethereumUrl,
      UPSTREAM_TIMEOUT_MS: '0',
    }),
  ).toThrow('positive integer')
})
