## Summary

Two overnight sessions on 2026-05-01 → 2026-05-02 produced a clean branch
`odds-overnight-2026-05-02` (8 commits) that bundles three independent
shippable pieces. Each commit can be merged or reverted on its own.

### What this PR does

1. **Reduces Supabase egress by ~50-60 %** in the cron path (commit `05516e5`).
   - In-memory PMR cache (TTL 5 min) shared across `recalcActiveMatchOdds`
     ticks → opponent-strength sweep no longer re-fetches per-player records.
   - `select`-only on three full-row `findMany`s (`closeBetsPreMatch`,
     `distributePayouts`, `tickMatchStatuses` staleMatches).
   - 30 s server-side cache on `GET /matches/:id` (UPCOMING/LIVE) +
     5 min cache on `GET /matches/:id/h2h`.

2. **Adds 15 new odds variants + an exact-score Monte Carlo simulator**
   (commits `0617461` + `48adb00`).
   - 35 variants run end-to-end against the snapshot. Top winner :
     `s2-combo-h2h-priority` (Brier 0.1909 vs baseline 0.2061, Acc 72.5 %, ECE 0.1951).
   - `services/odds/exactScore.ts` ships analytical + Monte Carlo
     implementations + 10 unit tests (all pass). ECE 0.019 on the
     historical 143 BO3/BO5/BO7 matches → well calibrated.

3. **Adds a Bug #1 remediation script** (`backend/scripts/cleanup-team-players.ts`)
   for the 6 team-name player rows already in DB. Dry-run reports 0
   live/upcoming matches affected — actual `--apply` is **not recommended**
   (see `audit/CLEANUP_TEAM_PLAYERS_DRY_RUN.md`).

### Recommended variant for prod

`s2-combo-h2h-priority` is the only variant that beats baseline simultaneously
on Brier (-0.0152), Accuracy (+0.7 pp), AND ECE (-0.0171). Override values:
```ts
h2hWeightScale: 0.50,         // baseline 0.30
h2hConfidenceMaxAt: 6,        // baseline 12
formWeight: 0.20,             // baseline 0.30
```

Suggest landing it behind a new env flag `ODDS_ENGINE_H2H_PRIORITY=true`,
running it side-by-side with the current engine for 50 matches via the
weekly backtest cron, and promoting if the live Brier confirms the backtest.

### Score exact — ready ?

✅ **Yes for prod**, but use the analytical closed-form
(`analyticalExactScore`) — the Monte Carlo equivalent is mathematically
identical when fed an iid `pPerGame`, just slower. The MC code stays for
the future "per-map probability" extension which requires civ × map data
that isn't yet ingested.

### Egress savings

Based on static analysis (audit/EGRESS_AUDIT_2026-05-02.md) :

| Source | Before | After | Saving |
|--------|--------|-------|--------|
| `recalcActiveMatchOdds` opp loop | 3-15 GB/mo | 0.5-2 GB/mo | ~5-13 GB |
| `recalcActiveMatchOdds` p1+p2 PMR | 3-7 GB/mo | 0.3-1 GB/mo | ~3-6 GB |
| Cron select-only fixes | 0.18 GB/mo | 0.01 GB/mo | ~170 MB |
| Route-level caches (`/matches/:id`, h2h) | trafic-dependent | -90 % | trafic-dependent |
| **Backend cron total** | **30-50 GB/mo** | **10-20 GB/mo** | **~50-60 %** |

Pro plan provides 250 GB/mo so we're well under either way; this just
makes Free-tier viable again if you ever want to downgrade.

### Risks

- **Cache staleness on PMR** : 5 min TTL means up to 5 min of slightly
  outdated player records used by the odds engine. PMR grows by ~1-2 rows
  per player per day; the engine itself recomputes every 10 min anyway.
  Invisible.
- **`s2-combo-h2h-priority` overfit risk** : N=153 matches isn't huge.
  Suggest the side-by-side flag rollout above.
- **Pooler URL switch** : `cleanup-team-players.ts` works only with the
  pooler (port 6543 + `?pgbouncer=true`). Documented in
  `audit/SUPABASE_STATUS.md` for any future devbox use.

### Test plan

Pre-merge :
- [x] Backend `tsc --noEmit` clean
- [x] All 10 exact-score unit tests pass
- [x] 36 variants ran end-to-end against snapshot, leaderboard generated
- [x] Cleanup dry-run executed (0 live matches affected)

Post-merge :
- [ ] Watch Supabase egress dashboard for 24 h after deploy → expect drop
- [ ] If `ODDS_ENGINE_H2H_PRIORITY=true` flipped on : run the weekly
      backtest cron and compare V1 vs new flag Brier on the next 3 weeks
- [ ] Verify `/matches/:id` and `/h2h` responses are still fresh enough
      (open match detail, refresh ; data should be ≤ 30 s / 5 min stale)

### Files in audit/ for review

Newly added this session :
- `audit/EGRESS_AUDIT_2026-05-02.md` — top 10 sinks + remediation
- `audit/EGRESS_TRACKING.md` — actual egress consumed during the runs
- `audit/SUPABASE_STATUS.md` — pooler URL fix + IPv6 root cause
- `audit/ODDS_BASELINE_2026-05-02.md` — 21 original variants ranking
- `audit/ODDS_RESULTS_FULL_2026-05-02.md` — full 36 variants with ROI
- `audit/ODDS_EXACT_SCORE_2026-05-01.md` — exact-score MC vs analytical
- `audit/EXACT_SCORE_VALIDATION.md` — calibration buckets + ECE
- `audit/CLEANUP_TEAM_PLAYERS_DRY_RUN.md` — Bug #1 remediation report
- `audit/OVERNIGHT_REPORT_2_2026-05-02.md` — full session report

### Out of scope / not in this PR

- The Bug #4 ledger commit (`4f83837`) lives on **master**, not this
  branch. Reviewable independently.
- Civ × map data pipeline — needed for the Phase 4 "civ matchup" / "map
  preference" variants that were originally requested. ~4-6 h schema +
  scraper work, separate ticket.
