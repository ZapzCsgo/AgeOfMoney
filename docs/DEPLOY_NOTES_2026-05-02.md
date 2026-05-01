# Deploy notes — `v-odds-overnight-2` (2026-05-02)

Tag : `v-odds-overnight-2` (merge commit `eb88099` on master).

## TL;DR

Behavior-preserving merge as long as no env var is changed. Two flags
were added — both default OFF. Flip on Railway after monitoring.

## DB migrations

**None.** The PR adds `Transaction.type` enum values via free-text strings
(no schema change) and writes new rows ; no migrations needed.

## Environment variables

### Required (already set in prod, no change)
- `DATABASE_URL`
- `JWT_SECRET`
- `STEAM_SECRET`
- `NOWPAYMENTS_API_KEY`
- `NOWPAYMENTS_IPN_SECRET`

### New flags introduced this release (default OFF — safe to leave unset)

#### `ODDS_ENGINE_H2H_PRIORITY`
- **Default** : `false`
- **Effect when `true`** : applies the s2-combo-h2h-priority overrides
  (h2hWeightScale 0.30→0.50, h2hConfidenceMaxAt 12→6, formWeight 0.30→0.20).
- **Backtest result** : Brier 0.2061 → 0.1909 (-0.0152), Acc 71.9 → 72.5 %,
  ECE 0.2122 → 0.1951.
- **Recommended sequence** : leave OFF for first 24-48 h post-deploy. Then
  flip ON via `railway variables set ODDS_ENGINE_H2H_PRIORITY=true` and
  watch the next ~50 LIVE matches via the weekly backtest cron.

#### `ODDS_ENGINE_V2_ENABLED`
- Pre-existing flag, **default false**, no change. Phase 3/4 backtests
  confirmed V2 is worse on the current sparse dataset.

## Deploy order

1. **Backend (Railway)** first — the env flag wiring lives in the engine.
   `git pull` → `npm install` → restart service.
2. **Frontend (Vercel)** afterwards — no frontend code change in this
   release, but a redeploy ensures latest cached build.

The merge is forward-compatible : an old frontend talking to a new backend
will keep working (no API contract change).

## Rollback

```bash
# revert the merge commit (creates a new commit, doesn't rewrite history)
git revert -m 1 eb88099
git push origin master

# OR, if you only want to disable the H2H flag (no code change):
railway variables unset ODDS_ENGINE_H2H_PRIORITY
# (or set ODDS_ENGINE_H2H_PRIORITY=false explicitly)
# then restart the service
```

## Exact-score API — existing vs new

Two pieces of code now exist, both correct, **DO NOT swap them blindly** :

1. **`GET /api/v1/bets/exact-scores/:matchId`** — already in prod, uses
   `exactScoreOddsBlended` from `services/exactScoreModel.ts` which blends :
   - theoretical binomial from match odds
   - H2H per-pair score history
   - per-player score history (recency × tier weighted)
   This is the richer model and is what users see when placing bets. **Keep it.**

2. **`backend/src/services/odds/exactScore.ts`** — newly added by this PR.
   - `analyticalExactScore(p, format)` : pure closed-form negative binomial
     from a per-game probability. Faster, simpler, no DB hit.
   - `simulateExactScore({pPerGame, format, simCount, perMapProb})` : Monte
     Carlo with 10k sims, deterministic seed, optional per-map probabilities.

   Both are library-only, **NOT wired into any HTTP route**. They exist for :
   - Backtest harness (`scripts/odds-experiments/variants/v36_exact_score_montecarlo.ts`)
   - Future per-map probability work (when civ × map data ingest lands)

   Calibration result (ECE 0.0193) is on the analytical-from-pPerGame path,
   not on the production blended model. The production blended model has
   not been re-validated this session.

If you want a third "pure analytical" endpoint for debug/A-B purposes :
add `GET /api/v1/odds/exact-score/:matchId` that calls
`analyticalExactScore(solvePerGameProb(prob1, format), format)`. ~15 LoC.
Skipped in this PR by deliberate decision — adding redundant endpoints is
egress hostile.

## Post-deploy checklist

After backend restart on Railway :

- [ ] `curl https://api.ageof.money/api/health` → 200 OK
- [ ] `curl https://api.ageof.money/api/v1/matches?limit=5` → real data
- [ ] `curl https://api.ageof.money/api/v1/bets/exact-scores/<matchId>` → real distribution
- [ ] Tail logs for `[OddsEngine]` line on boot (confirms boot reached the
      flag check). If you set `ODDS_ENGINE_H2H_PRIORITY=true`, you'll see
      `ODDS_ENGINE_H2H_PRIORITY active — using h2hWeightScale=0.50…`
- [ ] Watch Supabase egress dashboard for the next 24 h. The `recalcActiveMatchOdds`
      cron should drop from ~3-15 GB / day to <1 GB / day (per the Phase 1
      audit estimate).
- [ ] Bug #4 ledger : `SELECT type, COUNT(*) FROM "Transaction" WHERE
      "createdAt" > NOW() - INTERVAL '1 hour' GROUP BY type` should show
      new rows like `bet_placed`, `bet_won`, `coinflip_stake`, etc.

## What's NOT in this release

- **Civ × map per-game data** — needed to make `simulateExactScore` truly
  better than analytical. Schema work + scraper extension, ~4-6 h.
- **No new variant promoted to default** — the H2H-priority winner ships
  behind a flag for safety.
- **No frontend changes** — the existing exact-score UI keeps using the
  blended model from the existing endpoint.
- **`backend/scripts/cleanup-team-players.ts --apply` was NOT run.** 6
  orphan team-player rows remain in DB but they don't surface anywhere
  user-visible (0 live/upcoming matches affected). Run manually if you
  want them gone — see `audit/CLEANUP_TEAM_PLAYERS_DRY_RUN.md`.
