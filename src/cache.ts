import {getCache, getEnv} from '@vercel/functions'

// Keys are scoped to the deployment so a new release never serves values
// computed by old code.
const cache = getCache({namespace: getEnv().VERCEL_DEPLOYMENT_ID ?? 'local'})
const inflight = new Map<string, Promise<unknown>>()

// Returns the cached value for `key`, computing it at most once at a time:
// concurrent requests in this instance share one computation, and results are
// shared across instances in the region through the Vercel Runtime Cache.
// Failures are never cached. The key is chosen by the caller, so arbitrary
// query strings cannot bypass the cache.
export const cached = <T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
): Promise<T> => {
  const pending = inflight.get(key)
  if (pending) return pending as Promise<T>

  const promise = (async () => {
    const hit = await cache.get(key).catch(() => null)
    if (hit != null) return hit as T
    const value = await compute()
    await cache
      .set(key, value, {ttl: ttlSeconds})
      .catch((error: unknown) =>
        console.error('Runtime Cache set failed', error),
      )
    return value
  })().finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}
