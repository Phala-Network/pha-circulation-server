# pha-circulation-server

PHA circulating supply API, deployed on Vercel (`phala/pha-circulation-server`,
Node.js runtime).

## Endpoints

| Path | Response |
| --- | --- |
| `GET /api/circulation` | Plain-text total circulation (Ethereum + Base, 12 decimals, rounded down). |
| `GET /api/all` | Per-chain breakdown. `phala` and `khala` are intentionally zero after the Phala/Khala sunset. `sources` shows the blocks every value was read at and the indexer lag. |
| `GET /api/snapshot?date=YYYY-MM-DD` | Daily snapshot matching the legacy squid `Snapshot` rows: the first block of the UTC date (or the token deployment block on the deployment day). Dates from `2020-04-30`; `base` is `null` before `2024-04-05`. `404` until the date is finalized. Used by the Dune sync. |

All endpoints return `503` with `Cache-Control: no-store` when the data cannot be
calculated safely (upstream error or timeout, Goldsky lagging more than
`MAX_ETHEREUM_LAG_BLOCKS`, block hash mismatch, or a failed invariant). They
never fall back to stale values.

## Caching

Upstream load does not grow with traffic:

1. **Vercel CDN**: `s-maxage=60` for the latest values and one day for
   snapshots, cached per URL and region.
2. **Vercel Runtime Cache** (`src/cache.ts`): results are stored under fixed
   keys (`latest`, `snapshot:<date>`) for 60 seconds and 30 days, so extra query
   strings that miss the CDN still do not reach Goldsky or RPC. Keys are scoped
   to the deployment.
3. **Request coalescing**: concurrent misses in one instance share a single
   computation.

Failures are never cached, and snapshot dates outside the supported range are
rejected before any upstream call.

RPC goes through the Goldsky Edge endpoint `pha-circulation-api`, whose free
allowance is 1,000,000 requests per month. With the cache, `/api/all` costs at
most about 6 requests per minute (about 270,000 per month) regardless of
traffic, and a snapshot about 20. Check usage with
`goldsky edge metrics pha-circulation-api`.

## Data sources

- **Ethereum**: `vaultUnstakeLocked` comes from the
  [`phala-vault-state`](https://github.com/Phala-Network/phala-vault-state-subgraph)
  Goldsky subgraph. Every other value is read over RPC at the exact block
  Goldsky has indexed (EIP-1898 block hash, canonical only). Before the Vault
  deployment (block `21596326`) its values are zero, as in the legacy squid.
- **Base**: all values are read over RPC at the `finalized` block. No indexer.

Reads use viem's deployless multicall, so they work at any historical block,
including before Multicall3 was deployed on Ethereum (March 2022).

```text
ethereum = totalSupply - reward - sunsetReward - phalaChainBridge
         - khalaChainBridge - sygmaBridge - portalBridge - vaultReward
vaultReward = balanceOf(Vault) - totalAssets - treasuryAssets - vaultUnstakeLocked
base = totalSupply - reward - phalaChainBridge - khalaChainBridge
     - sygmaBridge - portalBridge
```

`vaultReward` can legitimately be negative (for example in November 2025, when
promised Vault rewards exceeded the funded balance).

## Configuration

Set these in the Vercel project settings. Do not commit them.

| Variable | Required | Description |
| --- | --- | --- |
| `GOLDSKY_VAULT_STATE_URL` | yes | GraphQL endpoint of the `phala-vault-state` subgraph. |
| `GOLDSKY_API_TOKEN` | no | Bearer token, only for private Goldsky endpoints. |
| `ETHEREUM_RPC_URL` | yes | Ethereum RPC with historical `eth_call` (archive) support. |
| `BASE_RPC_URL` | yes | Base RPC with historical `eth_call` (archive) support. |
| `MAX_ETHEREUM_LAG_BLOCKS` | no | Maximum Goldsky lag behind the Ethereum head. Default `50` (about 10 minutes). |
| `UPSTREAM_TIMEOUT_MS` | no | Timeout for each Goldsky and RPC request. Default `8000`. |

## Development

```bash
bun install
bun test
bunx tsc --noEmit -p .
vercel dev
```

`scripts/compare-legacy.ts` recomputes snapshots for the dates in the legacy
squid `Snapshot` exports and compares the block and every stored amount:

```bash
ETHEREUM_RPC_URL=... BASE_RPC_URL=... GOLDSKY_VAULT_STATE_URL=... \
  bun scripts/compare-legacy.ts ethereum.snapshot.csv base.snapshot.csv --every 30
```

## Rollback

Promote the previous production deployment in Vercel
(`vercel rollback --scope phala`). This only helps while the legacy
`subsquid.phala.network` circulation services are still running.
