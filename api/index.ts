import {Hono} from 'hono'
import {cors} from 'hono/cors'
import {BaseError} from 'viem'
import {cached} from '../src/cache'
import {getAllData} from '../src/circulation'
import {readConfig} from '../src/config'
import {
  SnapshotDateError,
  getSnapshot,
  parseSnapshotDate,
} from '../src/snapshot'

// Each layer bounds upstream load: the CDN caches per URL and region, and
// `cached` computes each key at most once per TTL behind it.
const LATEST_TTL_SECONDS = 60
const LATEST_CACHE_CONTROL =
  'public, max-age=60, s-maxage=60, stale-while-revalidate=60'
// Snapshots are read at finalized blocks and never change.
const SNAPSHOT_TTL_SECONDS = 30 * 24 * 60 * 60
const SNAPSHOT_CACHE_CONTROL = 'public, max-age=3600, s-maxage=86400'

// Never log raw provider errors: viem error messages include the RPC URL,
// which may embed an API key.
const describeError = (error: unknown) => {
  if (error instanceof BaseError) return `${error.name}: ${error.shortMessage}`
  if (error instanceof Error) return `${error.name}: ${error.message}`
  return 'Unknown error'
}

const loadLatest = async () => {
  try {
    return await cached('latest', LATEST_TTL_SECONDS, () =>
      getAllData(readConfig(process.env)),
    )
  } catch (error) {
    console.error(`Circulation unavailable - ${describeError(error)}`)
    return null
  }
}

const app = new Hono().basePath('/api').use('*', cors())

app.get('/circulation', async (c) => {
  const data = await loadLatest()
  if (data == null) {
    c.header('Cache-Control', 'no-store')
    return c.text('Service Unavailable', 503)
  }
  c.header('Cache-Control', LATEST_CACHE_CONTROL)
  return c.text(data.totalCirculation)
})

app.get('/all', async (c) => {
  const data = await loadLatest()
  if (data == null) {
    c.header('Cache-Control', 'no-store')
    return c.json({error: 'circulation_unavailable'}, 503)
  }
  c.header('Cache-Control', LATEST_CACHE_CONTROL)
  return c.json(data)
})

// Daily snapshot at the first finalized block of a UTC date, matching the
// legacy squid Snapshot rows. Used by the Dune sync for daily rows and gaps.
app.get('/snapshot', async (c) => {
  try {
    const date = c.req.query('date') ?? ''
    const target = parseSnapshotDate(date)
    const data = await cached(`snapshot:${date}`, SNAPSHOT_TTL_SECONDS, () =>
      getSnapshot(readConfig(process.env), target),
    )
    c.header('Cache-Control', SNAPSHOT_CACHE_CONTROL)
    return c.json(data)
  } catch (error) {
    c.header('Cache-Control', 'no-store')
    if (error instanceof SnapshotDateError) {
      return c.json(
        {
          error: error.status === 400 ? 'invalid_date' : 'not_available',
          message: error.message,
        },
        error.status,
      )
    }
    console.error(`Snapshot unavailable - ${describeError(error)}`)
    return c.json({error: 'snapshot_unavailable'}, 503)
  }
})

// Node.js runtime (Fluid compute) with the Web-standard fetch handler.
export default app
