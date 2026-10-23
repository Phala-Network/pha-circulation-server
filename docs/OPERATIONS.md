# Operations

## Data flow

```text
Ethereum Vault events ──> Goldsky subgraph phala-vault-state (prod tag)
                                  │ vaultUnstakeLocked + indexed block
Goldsky Edge RPC (pha-circulation-api) ──> this API (Vercel, hnd1)
   Ethereum at the indexed block,                ├─> /api/circulation ──> supply trackers
   Base at the finalized block                  └─> /api/all, /api/snapshot ──┐
Phala Cloud daily stats ─────────────────────────────────────────────────────┤
                                                                            v
                                    phala-dune-sync (Cloudflare Worker; hourly)
                                                │ Workers KV checkpoints
                                                v
                     Dune dune.phala_network.* ──> dune.com/phala_network/phala-analytics
```

The Worker runs in the Phala Cloudflare account from
[`scripts-toolbox/workers/dune-sync`](https://github.com/Phala-Network/scripts-toolbox/tree/main/workers/dune-sync).
Cron `5 * * * *` runs at five minutes past every hour (Pacific and UTC),
processing up to two dates per daily stream per run. Caught-up runs are no-ops.
Workers KV holds the checkpoints in `sync-state` and `realtime-date`, rather
than a local state file. See the
[`scripts-toolbox` README](https://github.com/Phala-Network/scripts-toolbox#manual-run)
for manual runs.

## Consumers

| Consumer | Uses |
| --- | --- |
| External price and supply trackers (about 180 requests/hour, unidentified) | `/api/circulation` |
| Cloudflare Worker `phala-dune-sync` (`scripts-toolbox`) | `/api/all` (realtime table), `/api/snapshot` (daily rows), Phala Cloud daily stats |
| Dune dashboard `phala_network/phala-analytics` | Dune tables below |

## Dune tables (`dune.phala_network`)

| Table | Written by |
| --- | --- |
| `dataset_phala_computation_snapshots` | Worker inserts daily rows, one per UTC date since 2020-04-30; up to two dates per hourly run |
| `dataset_phala_computation` | Worker CSV overwrite once per UTC day (realtime values) |
| `dataset_phala_cloud` | Worker inserts completed UTC days; up to two dates per hourly run |
| `dataset_phala_legacy_{ethereum,base,phala,khala}_circulation_snapshots` | One-time archive of the retired squids; not updated |

The realtime Phala row uses frozen final computation values from the retired
`phala-computation` squid (the Phala parachain ended; last snapshot
2025-11-19). Circulation values still come from `/api/all`.

**Status as of 2026-10-23.** The old OVH PM2 job silently stopped after
2026-09-23. The daily tables have no rows beyond the cloud checkpoint
2026-09-22 and snapshots checkpoint 2026-09-23. The Dune account's datapoint
limit is exhausted (uploads return HTTP 402). Once the limit is raised or the
billing cycle resets, the Worker backfills automatically.

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
- Check the Cloudflare dashboard's Worker logs and cron events for
  `phala-dune-sync`. Each daily stream checkpoints successful inserts in KV
  and retries from there on the next hourly run. A missing past snapshot date
  fails the run; an unfinalized snapshot for today waits for the next run.
  HTTP 402 from Dune means writes are blocked by the datapoint limit.

## Runbooks

**Subgraph change.** Deploy `phala-vault-state/<new version>`, wait until it is
synced without indexing errors, compare with
`VAULT_UNSTAKE_LOCKED_SOURCE=goldsky bun scripts/compare-legacy.ts ...`, move
the `prod` tag, and delete the old version.

**Missing Dune days.** Check Worker errors and Dune write capacity first.
Once writes succeed, each hourly run inserts up to two dates per daily
stream after its KV checkpoint. To check snapshots,
`SELECT MAX(updated_time) FROM dune.phala_network.dataset_phala_computation_snapshots`.
Compare it with `snapshots` in Workers KV `sync-state`; the Worker resumes
from KV, not from the latest Dune row. See the `scripts-toolbox` README for
manual runs and checkpoint reconciliation after an ambiguous insert failure.

**Rebuild the snapshots table.** In `scripts-toolbox`,
`bun src/duneSnapshotsTable.ts export`, then `recreate <backup>` and
`prepend-legacy <ethereum.snapshot.csv>`. Restore Dune write capacity first
and do not overlap the rebuild with scheduled or manual syncs. Verify that
the restored latest date matches `snapshots` in Workers KV `sync-state`;
the Worker backfills subsequent dates from that checkpoint.

**API rollback.** Before `vercel rollback --scope phala`, verify that the
target deployment uses Goldsky and RPC. Deployments that read the retired
squids fail with `410 Gone`.

## Legacy squid retirement

All `subsquid.phala.network` squids are retired:

- Circulation (Ethereum, Base, Phala, Khala) and Sygma: 2026-09-24.
- Computation, spore-vault, and phat-contract: 2026-10-23.

The hostname is now served by the Cloudflare Worker `subsquid-retired` from
[`scripts-toolbox/workers/subsquid-retired`](https://github.com/Phala-Network/scripts-toolbox/tree/main/workers/subsquid-retired),
returning `410 Gone` with the same bodies previously served by Caddy. It does
not depend on the OVH host.

Archives are in the Dune legacy tables, the
[`legacy-squid-archive-2026-09-23`](https://github.com/Phala-Network/pha-circulation-server/releases/tag/legacy-squid-archive-2026-09-23)
release (circulation dumps restore-tested), and the private S3 bucket
`phala-ovh-archive-481766170915` under
`archive/computation-squids-20261023/` and `archive/ovh-retired-20261023/`.

## Grafana

Grafana (`analytics.phala.network`) was retired on 2026-09-24: every path now
redirects to the Dune dashboard through a Cloudflare Redirect Rule.

## Sygma explorer indexer

Its only consumers were the Grafana dashboards, and `/sygma-explorer` had no
traffic, so it was retired on 2026-09-24 with Grafana: the route returns `410`,
now served by `subsquid-retired`.

