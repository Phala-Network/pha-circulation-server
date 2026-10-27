# pha-circulation-server

PHA circulating supply API on Vercel (`phala/pha-circulation-server`, Node.js).
Reads the `phala-ethereum` and `phala-base` Goldsky subgraphs; no RPC is used.

## API contract

Production base URL: `https://pha-circulation-server.vercel.app`.
All endpoints allow cross-origin requests (`Access-Control-Allow-Origin: *`).
Amounts are PHA decimal **strings**, calculated with integer wei precision.
`totalCirculation` adds Ethereum and Base and truncates to 12 decimal places,
without trailing zeros. Phala and Khala are zero after their parachain sunsets.

| Request                             | Content type                      | Response                                                                                                                                                     |
| ----------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/circulation`              | `text/plain; charset=UTF-8`       | Plain decimal total circulation, with no quotes, JSON wrapper, or newline. This is the supply-tracker endpoint.                                              |
| `GET /api/all`                      | `application/json; charset=UTF-8` | `phala`, `khala`, `ethereum`, `base`, `totalCirculation`, `sources`. Current chain values come from each subgraph's `Latest(id: "current")`.                 |
| `GET /api/snapshot?date=YYYY-MM-DD` | `application/json; charset=UTF-8` | `date`, `ethereum`, `base`, `totalCirculation`, from immutable `ChainDay(id: date)` rows. Dates start at `2020-04-30`; `base` is `null` before `2024-04-05`. |

`/api/all` chain objects retain these string fields:

- `phala` and `khala`: `circulation`, `crowdloan`, `reward`, `sygmaBridge`,
  `timestamp`, `totalIssuance`.
- `ethereum`: `circulation`, `phalaChainBridge`, `khalaChainBridge`, `reward`,
  `sygmaBridge`, `portalBridge`, `timestamp`, `totalSupply`, `vaultReward`.
- `base`: `circulation`, `totalSupply`, `timestamp`.

Each snapshot chain includes `blockNumber`, `timestamp`, `circulation`,
`totalSupply`; Ethereum also includes `reward`, `sunsetReward`,
`phalaChainBridge`, `khalaChainBridge`, `sygmaBridge`, `portalBridge`,
`vaultReward`, `vaultUnstakeLocked`. All are strings. `date` is midnight in
`YYYY-MM-DDT00:00:00.000000Z` form. Chain timestamps use the same six-digit
fractional precision; the zeroed parachain timestamps use ISO milliseconds.
The two Khala bridge balances are combined into `khalaChainBridge`.

### Snapshot convention and source metadata

Daily values are evaluated at **exactly 00:00 UTC, before events at that
instant**. The former RPC API used the first block at or after midnight,
including deployment-day balances. This changes historical amounts slightly;
the deployment-date snapshot now has zero supply. JSON keys and types stay the
same. `blockNumber` and the chain `timestamp` identify the **last observed event
or Clock poll at or before midnight**, rather than the final canonical block
before midnight. Both are zero (timestamp `1970-01-01T00:00:00.000000Z`) before
the token's deployment. The top-level `date` always identifies the requested
midnight, including on the deployment date.

In `/api/all`, `sources.ethereum` contains string fields `blockNumber`,
`indexedAt`, `lagSeconds`, `vaultUnstakeLocked`. `indexedAt` is the evaluation
time from `Latest.timestamp`, formatted like the chain timestamp;
`lagSeconds` is its nonnegative age when the response is computed. This
**replaces `headBlockNumber` and `lagBlocks`**. The subgraph's `_meta` is checked
for indexing errors and for an indexed block at least as high as the observed
block. `_meta.block.timestamp` is nullable and is not used.
`sources.base` retains string fields `blockNumber` and `blockTag`; `blockTag`
is now `indexed`. Both source block numbers identify the last observed event
or poll used for the current values; they do not claim RPC finality.

### Errors

Upstream failures/timeouts, malformed data, indexing errors, a `Latest` older
than 15 minutes, or `vaultImplementationReviewed=false` return **503** with
`Cache-Control: no-store`. Daily reads check both current `Latest` safety and
the requested day's implementation flag. There is no stale fallback.

`/api/circulation` returns plain `Service Unavailable`; `/api/all` returns
`{"error":"circulation_unavailable"}`; snapshots return
`{"error":"snapshot_unavailable"}`. Invalid dates return 400
(`invalid_date`); dates outside the supported range or not indexed yet return
404 (`not_available`). Date errors include a `message` and use `no-store`.
Other paths return plain `404 Not Found`.

## Caching

The existing cache headers are preserved:

| Data     | Cache-Control                                                | Runtime cache TTL |
| -------- | ------------------------------------------------------------ | ----------------- |
| Latest   | `public, max-age=60, s-maxage=60, stale-while-revalidate=60` | 60 seconds        |
| Snapshot | `public, max-age=3600, s-maxage=86400`                       | 30 days           |

Vercel consumes CDN directives, so public responses expose `max-age` without
`s-maxage`. The runtime cache uses deployment-scoped fixed keys (`latest`,
`snapshot:<date>`). Query strings do not bypass that cache; concurrent misses
share one computation. Upstream safety checks run on cache misses and failures
are never cached. A cache miss needs at most one GraphQL request per chain;
snapshots before Base deployment need only Ethereum.

Promote a new API deployment after moving a subgraph tag so cached historical
rows from the previous version do not survive for the runtime cache's 30 days.
Allow existing CDN snapshots to expire (up to one day) before treating all
historical responses as refreshed.

## Configuration

Copy `.env.example` to `.env.local` for local development. Configure the same
variables in Vercel; use the subgraphs' `/prod/gn` tag endpoints in production.

| Variable               | Required | Meaning                                                |
| ---------------------- | -------- | ------------------------------------------------------ |
| `GOLDSKY_ETHEREUM_URL` | yes      | Public `phala-ethereum/prod/gn` GraphQL URL.           |
| `GOLDSKY_BASE_URL`     | yes      | Public `phala-base/prod/gn` GraphQL URL.               |
| `UPSTREAM_TIMEOUT_MS`  | no       | Per-request timeout; positive integer, default `8000`. |

## Development

Use Node.js **24.x** and Bun **1.4.2**. Vercel and CI read the Node runtime
from `package.json` (`engines.node`). Biome is pinned exactly; the text
`bun.lock` is authoritative.

```bash
bun install --frozen-lockfile
bun run typecheck
bun test
bun run check
bun run start
```

Tests use mocked GraphQL and production response fixtures recorded in
`src/fixtures/production.json`. They verify endpoint keys/types, exact
plain-number formatting, errors, CORS, caching, and the midnight convention.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the stack's consumers, data
flow, upgrade and recovery runbooks, free allowance, and archives.
