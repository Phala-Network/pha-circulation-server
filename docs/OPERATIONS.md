# Operations

## Data flow

```text
Ethereum Vault events ──> Goldsky subgraph phala-vault-state (prod tag)
                                  │ vaultUnstakeLocked + indexed block
Goldsky Edge RPC (pha-circulation-api) ──> this API (Vercel, hnd1) ──> /api/all, /api/circulation
   Ethereum at the indexed block,                                  └─> /api/snapshot
   Base at the finalized block                                            │
                                                                          v
                  scripts-toolbox phalaDune.js (OVH, PM2 "dune", 01:05 UTC daily)
                                                                          │
                                                                          v
                     Dune dune.phala_network.* ──> dune.com/phala_network/phala-analytics
```

## Consumers

| Consumer | Uses |
| --- | --- |
| External price and supply trackers (about 180 requests/hour, unidentified) | `/api/circulation` |
| `scripts-toolbox` Dune sync | `/api/all` (realtime table), `/api/snapshot` (daily rows) |
| Dune dashboard `phala_network/phala-analytics` | Dune tables below |

## Dune tables (`dune.phala_network`)

| Table | Written by |
| --- | --- |
| `dataset_phala_computation_snapshots` | Daily insert, one row per UTC date since 2020-04-30 |
| `dataset_phala_computation` | Daily CSV overwrite (realtime values) |
| `dataset_phala_cloud` | Daily insert |
| `dataset_phala_legacy_{ethereum,base,phala,khala}_circulation_snapshots` | One-time archive of the retired squids; not updated |

## Free-tier limits

- **Goldsky subgraphs**: 2,250 worker hours per month fit exactly three
  always-on subgraphs (`phala-vault-state`, `phala-claimer`, `khala-claimer`).
  Never keep a fourth running beyond a version upgrade.
- **Goldsky Edge RPC**: 1,000,000 requests per month; expected use is about
  270,000. Starter plans cannot change the endpoint's 500 requests/minute
  per-IP limit, which is why the Dune sync paces backfills.
  Check with `goldsky edge metrics pha-circulation-api`.

## Checking health

There is no alerting. To check by hand:

- `curl https://pha-circulation-server.vercel.app/api/all`: `ethereum.timestamp`
  should be minutes old; `503` means an upstream is failing or lagging.
- Goldsky emails project members when a subgraph stalls.
- The Dune sync logs to `~/.pm2/logs/dune-{out,error}.log` on OVH. It stops at
  the first failing date and retries the remaining dates on the next run.

## Runbooks

**Subgraph change.** Deploy `phala-vault-state/<new version>`, wait until it is
synced without indexing errors, compare with
`VAULT_UNSTAKE_LOCKED_SOURCE=goldsky bun scripts/compare-legacy.ts ...`, move
the `prod` tag, and delete the old version.

**Missing Dune days.** Nothing to do: the next daily run inserts every date
after the latest row. To check,
`SELECT MAX(updated_time) FROM dune.phala_network.dataset_phala_computation_snapshots`.

**Rebuild the snapshots table.** In `scripts-toolbox`,
`bun src/duneSnapshotsTable.ts export`, then `recreate <backup>` and
`prepend-legacy <ethereum.snapshot.csv>`; the daily sync fills the rest.

**API rollback.** `vercel rollback --scope phala`. Previous deployments read
the legacy squids, so this only helps until they are retired.

## Legacy squid retirement

The `subsquid.phala.network` circulation squids (Ethereum, Base, Phala, Khala)
are frozen and no longer used by any known consumer. Their data is archived in
the Dune legacy tables and in the
[`legacy-squid-archive-2026-09-23`](https://github.com/Phala-Network/pha-circulation-server/releases/tag/legacy-squid-archive-2026-09-23)
release (dumps restore-tested). Retire them in steps:

1. Until about 2026-10-07: keep them running as the rollback path. Caddy
   access logs for `subsquid.phala.network` are in
   `/var/log/caddy/subsquid-access.log` on OVH.
2. If the logs show no remaining callers of the four `*-circulation` routes:
   remove the routes from `/etc/caddy/Caddyfile` (the log block can go too),
   stop the eight containers without removing volumes, and delete the four
   circulation data sources in Grafana.
3. About two weeks later: remove the containers and volumes.
