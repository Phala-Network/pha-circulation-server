# Operations

## Data flow

```text
Ethereum ──> Goldsky phala-ethereum/prod ──> this API (Vercel)
                                               ├─> /api/circulation ─> supply trackers
                                               ├─> /api/all ─> current analytics
                                               └─> /api/snapshot ─> daily API consumers

Goldsky ChainDay / VaultDay / ClaimDay ──┐
Phala Cloud daily stats ────────────────┼─> phala-analytics Worker
DefiLlama PHA price ───────────────────┘        │ SQLite cache
                                              v
                                     analytics.phala.network

apps claim page ──> phala-ethereum/prod (Khala and Phala claim logs)
```

The Ethereum subgraph owns chain-derived state, midnight snapshots, Vault
accrual and claim events. The circulation API formats its integer wei amounts
as decimal PHA strings; it does not call RPC or reconstruct historical blocks. The
`phala-analytics` Cloudflare Worker refreshes a SQLite cache and serves the
dashboard and JSON APIs. Archived Phala/Khala circulation stays frozen.
Cloud observations include values that cannot be reconstructed later;
weekly `cloud_daily` exports to R2 preserve those observations.

Circulation includes the Portal escrow backing bridged PHA on Base as
circulating on Ethereum. The `portalBridge` component remains available, but
the subgraph no longer subtracts it. `/api/circulation` and `totalCirculation`
use Ethereum `circulation` alone, with the existing 12-decimal plain-number
format. Relative to the former Ethereum-plus-Base total, this adds Portal
escrow minus bridged supply (approximately 50,000 PHA when the definition
changed). Historical snapshots use the same definition. Both JSON endpoints
retain `base: null`; `/api/all` retains `sources.base: null`. There is no
separate bridged-chain indexer or API request. Verify the subgraph uses this
formula before deploying the API.

The circulation API runs on Node.js 24.x, pinned by `engines.node` in
`package.json`. Vercel uses that pin; CI reads the same value before running
the Bun toolchain.

Code and component-specific commands:

- [Subgraphs](https://github.com/Phala-Network/phala-subgraphs):
  manifests, mappings, ABI review, builds, deploy commands and parity verifier.
- [Analytics Worker](https://github.com/Phala-Network/scripts-toolbox/tree/main/workers/phala-analytics):
  refresh, cache schema, archive seeding, exports, deployment and secrets.
- [Circulation API contract](../README.md): endpoint shapes, date convention,
  cache headers and environment variables.

## Consumers

| Consumer                           | Contract                                                                                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| External supply trackers           | `https://pha-circulation-server.vercel.app/api/circulation`, a plain decimal with no newline or JSON wrapper. Individual tracker identities are not recorded. |
| Analytics current circulation      | `/api/all`; the Phala/Khala objects are zero.                                                                                                                 |
| Daily API consumers                | `/api/snapshot?date=YYYY-MM-DD`; values at exactly 00:00 UTC, last-observed block metadata.                                                                   |
| `phala-analytics` Worker           | Direct `ChainDay`, `VaultDay`, `ClaimDay` reads; Phala Cloud daily stats and DefiLlama price (CoinGecko-sourced).                                             |
| `analytics.phala.network`          | Dashboard and JSON APIs served by the analytics Worker.                                                                                                       |
| apps claim page                    | `Claimed` (Khala) and `ClaimedAndBridged` (Phala) from `phala-ethereum/prod/gn`; eligibility and transactions use contracts directly.                         |
| Snapshot space `phala-network.eth` | Separate Phala L2 voting-power API described below.                                                                                                           |

## Goldsky deployments and limits

The only deployed subgraph is `phala-ethereum/1.1.0`, with `prod` pointing to
that version. `phala-vault-state`, `khala-claimer` and `phala-claimer` have been
deleted; the Ethereum subgraph now supplies their data.

The project is on Starter; check remaining credits in the dashboard. Starter's
one-time credit is not an ongoing free allowance. Scale's free allowance is
**2,250 worker-hours/month** and about **100,000 stored entities**, team-wide.
Goldsky enforces a hard cap of **three deployed subgraphs, including paused
versions**. Leave room for a temporary upgrade version. Pausing frees worker
time, not a deployment slot or storage.

The Edge RPC endpoint `pha-circulation-api` is unused (0 requests since the API
cutover), but Starter does not allow its deletion. No current consumer uses it.

Count every deployed name/version before a deploy and check stored entities
after sync. Deploy one replacement at a time and delete the superseded
version after verification. Paused subgraphs still serve stale data and can eventually be deleted by Goldsky;
they are not durable archives. Export any irreplaceable comparison data before
deleting a version. These limits also apply during rollback.

## Runbooks

### Subgraph upgrade and tag

1. Review changes to contract ABIs, excluded balances, or accrual formulas.
   For a Vault implementation upgrade, verify the implementation and its
   getters, update the allowlist/formula dispatch, and rebuild. Do not simply
   override `vaultImplementationReviewed`.
2. Check deployment slots, worker-hours and entity budget. Build and deploy
   one replacement version using the subgraph repository's commands. Full
   historical mappings need a full sync; a short-range feature test cannot
   validate historical balances.
3. Wait for sync. Query `Latest(id: "current")` and `_meta`: no indexing
   errors, `Latest.timestamp` within 15 minutes, reviewed Vault implementation.
   Compare amounts, Vault checkpoints and complete claimer ID/field sets with
   preserved independent references using the subgraph parity verifier.
4. Move `phala-ethereum/prod` to the verified version. Both the API and apps
   use tag URLs; the Worker tracks `_meta.deployment` and reloads chain-derived
   cache rows after it changes.
5. Promote a fresh circulation API deployment to change its runtime cache
   namespace. Existing daily CDN responses can take up to one day to expire.
   Verify plain-number output, `/api/all` totals and sampled daily values
   against `ChainDay`, confirm both JSON endpoints have `base: null`, and
   check the apps claim logs.
6. Delete the superseded version after consumer verification. Keep total
   deployed versions at or below three.

Before deleting the old version, rollback can move `prod` back and promote a
fresh API deployment. After deletion, recovery requires redeploying and
resyncing that version; deleting an indexer is not an instant rollback.

### API returns 503

Read the configured Ethereum subgraph's `Latest` and `_meta` directly. Confirm
the URL uses the expected `prod` tag, indexing is error-free, the latest
timestamp is within 15 minutes, and `vaultImplementationReviewed` is true. A current
indexing failure or unreviewed implementation also blocks uncached daily
reads. Check Vercel logs for the error class and the subgraph for details.

Repair indexing or review the new implementation before moving a tag. The API
does not use RPC or stale fallback data. Invalid or unavailable dates return
400/404 and are not cached. Promote a previous API deployment only after
checking that its upstream services still exist; versions dependent on
retired squids, RPC or deleted subgraphs cannot restore service.

### Analytics gaps or cache rebuild

Inspect the Worker's refresh errors, upstream availability and last successful
cache checkpoints. Failed requests must not advance a checkpoint. Resume the
refresh after repairing the upstream. Chain-derived rows can be rebuilt from
the Ethereum subgraph; a changed `_meta.deployment` triggers their reload.

Cloud history is not fully recoverable from its upstream API. Preserve
`cloud_daily`, restore it from the latest R2 export when necessary, and verify
the restored row count and latest observation before refreshing. Archived
Phala/Khala circulation and historical Cloud rows come from the preserved
exports, not a fresh chain scan. Follow the Worker README for exact commands.

## Phala L2 voting power

[`l2-indexer`](https://github.com/Phala-Network/l2-indexer) runs in a Phala Cloud
prod7 CVM at
`https://daa34fe16ce7c191bf9e340066866ed2d23e95f6-3000.dstack-pha-prod7.phala.network`.
Snapshot space `phala-network.eth` uses its `api` strategy for the Phala L2 vPHA
token (`0xFdCE…c856`). Goldsky does not support Phala L2, so this remains a
separate service. It is outside the circulation formula and the Ethereum
subgraph. There is no monitoring configured for it.

## Archives and retired services

Dune exports and retired host backups are preserved in the private S3 archive
managed by the Phala operations team. Legacy circulation dumps are also in the
[`legacy-squid-archive-2026-09-23`](https://github.com/Phala-Network/pha-circulation-server/releases/tag/legacy-squid-archive-2026-09-23)
release and were restore-tested. The Dune dashboard is an archive, not the live
analytics data source; the old Grafana service is retired.

All `subsquid.phala.network` squids, including circulation, Sygma, computation,
spore-vault and phat-contract, are retired. The Cloudflare Worker
[`subsquid-retired`](https://github.com/Phala-Network/scripts-toolbox/tree/main/workers/subsquid-retired)
returns `410 Gone`; restoring an old consumer does not restore these services.
