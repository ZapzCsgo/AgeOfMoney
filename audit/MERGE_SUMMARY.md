# Merge summary — `odds-overnight-2026-05-02` → `master`

Generated 2026-05-02 by Claude Code session 3.

## Diffstat

- 25 files changed
- 78 576 insertions(+), 38 deletions(-)

The bulk of the line count comes from `audit/ODDS_VARIANTS_2026-05-0{1,2}.json`
(per-prediction dumps from the variant harness, ~75k lines combined). Strip
those and the actual code change is ~640 LoC.

## Commits (oldest → newest)

| # | Hash | Subject | Risk |
|---|------|---------|------|
| 1 | `05516e5` | feat(egress): cache PMR + select-only fixes for top 5 cron sinks | 🟢 Low — read-side cache w/ TTL, behavior preserved |
| 2 | `0617461` | feat(odds): 15 new tunable variants + exact-score Monte Carlo (Phases 4+5) | 🟢 Low — scripts + library + tests, no prod call site |
| 3 | `48adb00` | docs(overnight2): final report for night 2 | 🟢 Doc-only |
| 4 | `0d26551` | docs(odds-overnight-2): backtest results + analyzers + PR description | 🟢 Doc + analyzers (script-only) |
| 5 | `d9e4bb7` | feat(odds): feature flag ODDS_ENGINE_H2H_PRIORITY | 🟡 Medium — touches `oddsEngine.ts` but flag default false ⇒ no behavior change in prod |
| 6 | `803872c` | chore(env): document pooler URL + odds engine flags in .env.example | 🟢 Doc-only |

## Risk per commit

### `05516e5` — egress optims
- **Touches**: `backend/src/services/pmrCache.ts` (NEW), `backend/src/cron/jobs.ts`,
  `backend/src/routes/matches.ts`.
- **Behavior change**: cron `recalcActiveMatchOdds` now reads PMR from a 5 min
  TTL cache instead of fresh DB hits. Odds output identical (cron itself runs
  every 10 min so cache TTL is wider than recompute cadence).
- **Routes**: `/matches/:id` UPCOMING/LIVE responses cached 30 s in memory
  (was uncached) ; `/matches/:id/h2h` cached 5 min.
- **Risk** : near-zero. Worst case a UPCOMING match's bet volume display
  is up to 30 s stale.

### `0617461` — variants + exact-score
- **Touches**: scripts only + `backend/src/services/odds/{exactScore.ts, __tests__/}`.
- **No prod call site** : the new `exactScore` module is exported but not
  imported by any route or cron yet. Will be wired by the Phase C endpoint.
- **Risk** : zero. Pure additions.

### `48adb00`, `0d26551`, `803872c` — docs
- Audit MD files + `.env.example`. No runtime impact.

### `d9e4bb7` — H2H priority flag
- **Touches**: `backend/src/services/oddsEngine.ts` (3 hunks, ~26 LoC).
- **Default**: `process.env.ODDS_ENGINE_H2H_PRIORITY === 'true'` → false unless
  set. With the flag off, every constant resolves to its baseline value
  (`H2H_WEIGHT_SCALE=0.30`, `H2H_CONFIDENCE_MAX=12`, `FORM_WEIGHT=0.30`) —
  byte-identical output to the pre-merge engine.
- **Risk** : zero with flag off ; medium when flag is flipped (depends on
  whether the backtest's Brier improvement transfers to live).

## Recommended merge sequence

1. `git checkout master && git pull origin master`
2. `git merge --no-ff odds-overnight-2026-05-02 -m "<msg>"`
3. `git push origin master`
4. `git tag -a v-odds-overnight-2 -m "..."` then `git push origin v-odds-overnight-2`
5. Deploy backend (Railway) — env vars unchanged, behavior unchanged
6. Deploy frontend if any frontend changes shipped (none in this branch)

## Post-merge

- Monitor Supabase egress dashboard for 24 h → expect drop of 50-60 % in
  `recalcActiveMatchOdds` lines.
- After 24 h, optionally flip `ODDS_ENGINE_H2H_PRIORITY=true` on Railway
  for 50-100 matches and compare live Brier vs the previous engine via
  the weekly backtest cron.

## Rollback

If anything breaks :
```bash
git revert -m 1 <merge_commit_hash>
git push origin master
```
The merge commit will be a single point of reversion. Cron jobs reset to
their pre-merge state on the next service restart.

To rollback ONLY the H2H flag without touching the egress optims (which
are independently shippable), unset the env var on Railway — no code
revert needed.
