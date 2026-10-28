# pha-circulation-server

PHA circulating supply API on Vercel (`phala/pha-circulation-server`, Node.js).
Reads the `phala-ethereum` Goldsky subgraph; no RPC is used.

## API contract

Production base URL: `https://pha-circulation-server.vercel.app`.
All endpoints allow cross-origin requests (`Access-Control-Allow-Origin: *`).
Amounts are PHA decimal **strings**, calculated with integer wei precision.
`totalCirculation` is Ethereum `circulation`, truncated to 12 decimal places
without trailing zeros. Phala and Khala are zero after their parachain sunsets.

| Request                             | Content type                      | Response                                                                                                                                        |
| ----------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/circulation`              | `text/plain; charset=UTF-8`       | Plain decimal total circulation, with no quotes, JSON wrapper, or newline. This is the supply-tracker endpoint.                                 |
| `GET /api/all`                      | `application/json; charset=UTF-8` | `phala`, `khala`, `ethereum`, `base`, `totalCirculation`, `sources`. Current values come from `Latest(id: "current")`; `base` is always `null`. |
| `GET /api/snapshot?date=YYYY-MM-DD` | `application/json; charset=UTF-8` | `date`, `ethereum`, `base`, `totalCirculation`, from immutable `ChainDay(id: date)` rows. Dates start at `2020-04-30`; `base` is always `null`. |

`/api/all` chain objects retain these string fields:

- `phala` and `khala`: `circulation`, `crowdloan`, `reward`, `sygmaBridge`,
  `timestamp`, `totalIssuance`.
- `ethereum`: `circulation`, `phalaChainBridge`, `khalaChainBridge`, `reward`,
  `sygmaBridge`, `portalBridge`, `timestamp`, `totalSupply`, `vaultReward`.

The snapshot `ethereum` object includes `blockNumber`, `timestamp`,
`circulation`, `totalSupply`, `reward`, `sunsetReward`, `phalaChainBridge`, `khalaChainBridge`, `sygmaBridge`, `portalBridge`,
`vaultReward`, `vaultUnstakeLocked`. All are strings. `date` is midnight in
`YYYY-MM-DDT00:00:00.000000Z` form. Chain timestamps use the same six-digit
fractional precision; the zeroed parachain timestamps use ISO milliseconds.
The two Khala bridge balances are combined into `khalaChainBridge`.

### Circulation definition

Portal escrow backing PHA on Base counts as circulating **on Ethereum**.
The subgraph no longer subtracts `portalBridge` from Ethereum circulation;
`portalBridge` remains visible as a component. The API uses the subgraph's
`circulation` directly and does not add a separate bridged-chain supply.
Compared with the former Ethereum-plus-Base total, this adds the difference
between Portal escrow and bridged supply, approximately **50,000 PHA** at the
time of the definition change. Historical snapshots use this definition too.

Both JSON endpoints retain `base` as `null`, and `/api/all` also retains
`sources.base` as `null`. These replace the former objects; consumers must
accept `null` while the Ethereum keys and types remain unchanged. The tracker
endpoint keeps its plain-number byte format. Deploy with a subgraph version
that includes Portal escrow in circulation.

### Snapshot convention and source metadata

Daily values are evaluated at **exactly 00:00 UTC, before events at that
instant**. The former RPC API used the first block at or after midnight,
including deployment-day balances. This changes historical amounts slightly;
the deployment-date snapshot now has zero supply. Ethereum keys and types stay
the same. `blockNumber` and the chain `timestamp` identify the **last observed
event or Clock poll at or before midnight**, rather than the final canonical block
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
The source block number identifies the last observed event or poll used for
the current values; it does not claim RPC finality.

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
are never cached. Each cache miss needs one GraphQL request to Ethereum.

Promote a new API deployment after moving a subgraph tag so cached historical
rows from the previous version do not survive for the runtime cache's 30 days.
Allow existing CDN snapshots to expire (up to one day) before treating all
historical responses as refreshed.

## Configuration

Copy `.env.example` to `.env.local` for local development. Configure the same
variables in Vercel; use the subgraph's `/prod/gn` tag endpoint in production.

| Variable               | Required | Meaning                                                |
| ---------------------- | -------- | ------------------------------------------------------ |
| `GOLDSKY_ETHEREUM_URL` | yes      | Public `phala-ethereum/prod/gn` GraphQL URL.           |
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
`src/fixtures/production.json`. They verify endpoint keys/types (with the
documented null fields), Portal accounting, plain-number formatting, errors, CORS, caching, and the midnight
convention.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for the stack's consumers, data
flow, upgrade and recovery runbooks, free allowance, and archives.
