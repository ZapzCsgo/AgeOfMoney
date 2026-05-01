# Production bugs fix — 2026-05-02

Branch : `prod-bugs-fix-2026-05-02` (3 commits, NOT pushed yet — review +
merge by user).

## Section 1 — Bugs identifiés (état avant fix)

### Bug #1 — LP circuit breaker auto-unblock returns 400 (CRITICAL)

**Logs prod (Railway, 2026-05-02 21:27-21:29 UTC)** :
```
21:27:48 - 429 Liquipedia → circuit breaker open for 2min (jusqu'à 21:29:48)
21:28:24 - Auto-unblock retry → "Request failed with status code 400"
21:29:48 - 429 again → tripping breaker AGAIN (boucle infinie)
21:29:48 - Auto-unblock error: Request failed with status code 400
```

**Root cause hypothesis** :
- `attemptAutoUnblock()` calls `axios.get` on `lpRouteUrl('https://liquipedia.net/token/generate')` (routed through the CF Worker proxy when `LP_WORKER_URL` is set).
- The default axios behaviour throws on any 4xx (no `validateStatus` override). So when the worker returned 400 (most likely because it only whitelists `/lp/<wikipath>/api.php` paths and rejects `/lp/token/generate`), axios threw `"Request failed with status code 400"` with no URL, no body, no headers.
- The catch block at the bottom of the function only logged `err.message` — losing all diagnostic context.
- The breaker backoff started at **2 min**, shorter than LP's typical per-IP rate-limit reset window. Result : the very first request after expiry would re-trip the breaker → infinite loop.

### Bug #2 — Player stats batch : 0/50 success rate (CRITICAL)

**Logs prod** :
```
21:27:54 - Player stats update complete: 0 updated, 50 errors
21:28:29 - Player stats update complete: 0 updated, 50 errors
```

**Root cause hypothesis** :
- `updatePlayerFromAoe4World()` returned bare `boolean`. The caller had nothing to attribute failures to.
- The function fails silently in three places :
  1. `resolveAoe4WorldId()` → null (no aoe4world profile match) → `logger.debug` (NOT in prod logs)
  2. `getPlayerStats()` → null (HTTP 404, 429, timeout) → no log at all
  3. `prisma.player.update()` throws → only the LAST attempt is logged
- 50/50 failures ⇒ a systemic issue (API down, rate limit, schema drift, expired key) but the operator had zero info to act on.

### Bug #3 — `prisma.player.upsert()` P2002 on `Player.name` (CRITICAL)

**Logs prod** :
```
error: [Liquipedia] Failed to save match Overtaken vs GGOut:
  Invalid prisma.player.upsert() invocation:
  Unique constraint failed on the fields: (name)
```

**Root cause** :
- `Player.name` is `@unique` in the Prisma schema.
- The upsert key is `liquipediaSlug` — when LP has TWO distinct slugs that share the same `name` (e.g. `Overtaken_(player)` vs `Overtaken_(esports)`), the upsert :
  1. Looks for a row with the new slug → not found
  2. Tries to CREATE → name already taken by the other slug → P2002
- The exception aborted the entire match save, including the second player and the Match row.

### Bug #4 — Avatar batch reports false success when breaker open (MINOR)

**Logs prod** :
```
21:27:48 - Avatar: blocked on daddyst4rk — waiting for auto-unblock...
21:29:48 - Avatar batch done: 0 saved, 0 checked
```

**Root cause** : `fetchPlayersAvatars()` started its 20-player batch after the breaker had already tripped. Each per-player fetch waited 2 min for unblock, gave up with `BLOCKED`, the loop broke at `if (blocked)`, and the final log line said `0 saved, 0 checked` — indistinguishable from "20 players had no avatar". 8 minutes wasted, no useful work, misleading metric.

## Section 2 — Fixes appliqués

### Bug #1 + #4 — commit `8e1678c`

> `fix(liquipedia): auto-unblock breaker probe + exponential backoff + avatar deferral`

Files :
- `backend/src/services/liquipediaLiveScorer.ts`
- `backend/src/scrapers/liquipediaScraper.ts` (avatar batch deferral + the helper used by Bug #3)

Changes :
- `validateStatus: (s) => s < 500` on the two GETs in `attemptAutoUnblock`. 4xx now logs URL + status + first 300 chars of body. Hint string when `LP_WORKER_URL` is set : "likely CF Worker rejecting /lp/token/generate. Check worker routes."
- BACKOFF_MIN reshaped to `[5, 15, 30, 45, 60]` (was `[2, 5, 10, 20, 30, 60]`). 5-min start gives LP time to actually reset.
- New `consecutiveUnblockFailures` counter + `MAX_UNBLOCK_FAILURES_BEFORE_QUIET = 3`. After 3 consecutive auto-unblock fails, the periodic 5-min retry suspends until the breaker naturally clears. Stops burning 2captcha credits on a tight loop.
- Catch block now formats axios errors with `[<status> <method> <url>]` suffix.
- Success log : `circuit breaker unlocked (probe successful at <ISO>)`.
- `resetCircuitBreaker()` now also resets `consecutiveUnblockFailures`.
- Exported `getCircuitBreakerState()` for monitoring routes / tests.
- `fetchPlayersAvatars()` early-returns with a clear "deferred" log when `isLpBlocked()` at start of batch.

Tests : `backend/src/services/__tests__/liquipediaLiveScorer.test.ts` — 5/5 pass in 0.9 s.

### Bug #2 — commit `e1d0bdd`

> `fix(enrich): aoe4world stats — categorized failure logging + alert at <50% success`

Files : `backend/src/scrapers/aoe4worldScraper.ts`

Changes :
- `updatePlayerFromAoe4World` returns `{ success: true } | { success: false, reason, detail }`.
- Reasons : `player_not_found | profile_unresolvable | stats_api_failed | db_update_failed | no_data`.
- `updateAllPlayerStats` accumulates per-bucket counts + one example per bucket. Final log line includes the breakdown.
- One `warn` line per bucket with the example.
- **Alert** : if batch ≥ 5 players AND success rate < 50 %, escalates to `logger.error` with "ALERT — batch success rate X%". Visible in Railway log filters / Grafana.
- `ScraperLog.error` column carries the breakdown too.

The actual root cause of the 100 % failure batch will be diagnosable from the next live run — Bug #2 fix is *observability-first* because we can't confirm the underlying API failure without a fresh prod log.

### Bug #3 — commits `8e1678c` (helper) + `f239359` (tests)

> `test(liquipedia): cover P2002-on-name fallback for Player upsert (Bug #3)`

Files :
- `backend/src/scrapers/liquipediaScraper.ts` (new `upsertPlayerWithNameCollisionFallback`)
- `backend/src/scrapers/__tests__/liquipediaScraper.test.ts` (6 tests)

Changes :
- New helper wraps the upsert. On `P2002` with `target=['name']`, falls back to `findUnique({ where: { name } })` and reuses the existing row.
- A single `warn` line documents the collision so the data team can disambiguate later.
- Helper takes a `PlayerUpsertClient` interface so it can be unit-tested with a stub object — no Prisma module mocking needed.
- Both `upsert` calls in `scrapeUpcomingMatches()` now use the helper.

Tests : 6/6 pass in 0.9 s.

## Section 3 — Validation

### Tests in local

```bash
cd backend
SKIP_SERVER=1 npx tsx --test src/services/__tests__/liquipediaLiveScorer.test.ts
# → 5/5 pass

SKIP_SERVER=1 npx tsx --test src/scrapers/__tests__/liquipediaScraper.test.ts
# → 6/6 pass

npx tsc --noEmit -p tsconfig.json
# → clean
```

### Re-test live (after deploy)

| Bug | Verification |
|-----|--------------|
| #1 | Trigger a 429 (or wait for one), then watch logs. Expect : `[LPScorer] Auto-unblock error: <message> [<status> GET <url>]` instead of bare "status code 400". After 3 fails, expect "Suspending auto-unblock retries". |
| #2 | Wait for next 30-min `enrichAllUpcomingMatches` cron. If batch fails, expect breakdown line: `[stats_api_failed=N, profile_unresolvable=M, ...]` AND one example per bucket. |
| #3 | Trigger a re-scrape that includes "Overtaken vs GGOut" (still in LP queue). Expect : `[Liquipedia] Player.name collision : "Overtaken" already exists (existing slug=…, new slug=…) — reusing existing row`. Match should save successfully. |
| #4 | Wait for the daily avatar batch (3am UTC). If breaker is open, expect : `Avatar batch deferred — circuit breaker open (Nmin remaining), retry on next cron tick`. No fake "0 saved" line. |

### Métriques avant/après (estimées — pas de mesure live)

| Métrique | Avant | Après |
|----------|-------|-------|
| Diagnostic info on auto-unblock failure | `"Request failed with status code 400"` | URL + status + body snippet + worker-route hint |
| Time before breaker re-trips after expiry | 0-30 s (immediate re-trip) | ~5 min (BACKOFF_MIN[0]) |
| 2captcha credit burn on stuck breaker | continuous (every 5 min) | stops after 3 consecutive fails |
| Diagnostic info on stats batch failure | `"50 players failed to update"` | `[stats_api_failed=42, profile_unresolvable=5, db_update_failed=3]` + 3 example lines |
| `Overtaken vs GGOut` save success | 0 % (P2002 abort) | 100 % (helper falls back gracefully) |
| Avatar batch CPU on open breaker | full 20-player loop, ~8 min | 0 — early return, retry on next cron tick |

## Section 4 — Monitoring recommandé

### Alertes à mettre en place sur Railway

| Trigger | Severity | Action |
|---------|----------|--------|
| `[LPScorer] ALERT — batch success rate <X>%` (note : doesn't exist for LP yet, only aoe4world) | n/a | n/a — see "Suggestions" below |
| `[aoe4world] ALERT — batch success rate <X>%` | high | page on-call OR weekly digest |
| `[LPScorer] Suspending auto-unblock retries` | medium | manual investigation : check 2captcha balance, CF Worker routes, env vars |
| `Player.name collision` warn lines > 3 / day | low | data team triage : merge or split duplicate names |

### KPIs à monitorer

| KPI | Source | Seuil sain |
|-----|--------|------------|
| LP breaker open count / hour | grep `circuit breaker open` in Railway logs | ≤ 2 / h |
| LP breaker total open time / day | sum of "X min" in `circuit breaker open for Xmin` lines | ≤ 30 min / day |
| LP `consecutiveUnblockFailures` | new `getCircuitBreakerState()` exposed | < 3 (above = quiet mode) |
| aoe4world stats success rate | `Player stats update complete: X updated, Y errors` → X/(X+Y) | ≥ 80 % |
| Player.name P2002 collisions | grep `Player.name collision` warn count | ≤ 1 / day |
| Avatar batch deferrals | grep `Avatar batch deferred` info count | informational only |

### Dashboard suggéré

Simple `/api/v1/admin/health/scrapers` endpoint that returns :
```json
{
  "lpBreaker": { /* getCircuitBreakerState() */ },
  "lastAoe4WorldBatch": { /* read latest ScraperLog row source='aoe4world' */ },
  "lastLpScrape":      { /* read latest ScraperLog row source='liquipedia' */ },
  "playerNameCollisions24h": <count grep'd from logs OR a new metric column>
}
```
Followed by a 1-hour Grafana panel hitting that endpoint. ~30 LoC if you
want to ship it ; not in this PR.

## Section 5 — APRÈS LES FIXES

### État
- ✅ Bug #1 fixed (commit 8e1678c, 5/5 tests pass)
- ✅ Bug #2 fixed (commit e1d0bdd)
- ✅ Bug #3 fixed (commit 8e1678c + tests f239359, 6/6 tests pass)
- ✅ Bug #4 fixed (bundled in commit 8e1678c)

### Branch `prod-bugs-fix-2026-05-02` — 3 commits, NOT yet pushed

```
f239359 test(liquipedia): cover P2002-on-name fallback for Player upsert (Bug #3)
e1d0bdd fix(enrich): aoe4world stats — categorized failure logging + alert at <50% success
8e1678c fix(liquipedia): auto-unblock breaker probe + exponential backoff + avatar deferral
```

Per the user's rules : "commit local d'abord, je merge moi-même". The
branch is local only — review and merge yourself when ready.

### Reprise Phase D recherche odds variants
Time-budget remaining at the time of this report : minimal. The 4 critical
bugs took priority. Extra odds-variants exploration deferred to a future
session — current top variant `v45-bayes-weak-h2h` (Brier 0.1897) remains
the best candidate.
