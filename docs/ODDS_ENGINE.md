# Odds Engine — Reference

Living document of the AgeOfMoney odds engine : current production behaviour,
flags, every variant ever tested with its result, and the testing process.

Source files :
- `backend/src/services/oddsEngine.ts` — production engine
- `backend/scripts/odds-experiments/` — variant harness (tunable clone +
  variants list + backtest runner)
- `backend/src/services/odds/exactScore.ts` — exact-score model (analytical
  + Monte Carlo)

## Production state — 2026-05-02

### Flags currently in prod

| Flag | Default | Effect when true |
|------|---------|------------------|
| `ODDS_ENGINE_V2_ENABLED` | `false` | Activates Phase 1 V2 features (half-life 90d, wrLogitDiff scale 1.15, momentum, rust v2, SOS). Backtests show this is **worse** on the current sparse dataset — keep OFF. |
| `ODDS_ENGINE_EXACT_V2_ENABLED` | `true` | Forces overround = 17.6 % on every odd-BO. Already ACTIVE in prod since 2026-04-19. |
| `ODDS_ENGINE_H2H_PRIORITY` | `false` | Overnight 2 #1 winner. h2hWeightScale 0.30→0.50, h2hConfidenceMaxAt 12→6, formWeight 0.30→0.20. **Recommend after monitoring.** |
| `ODDS_ENGINE_BAYES_WEAK_H2H` | `false` | Session 3 winner — strict improvement on H2H_PRIORITY (adds priorStrength 5→1). **Best variant identified to date.** Implies H2H_PRIORITY. |

### Engine factor weights (default, V1 path)

| Factor | Weight | Source |
|--------|-------:|--------|
| Competitive winrate | adaptive ≥ 35 % | tier-weighted Bayesian, decayed PMR |
| Head-to-head | adaptive 0–30 % (×0.50 under H2H_PRIORITY) | direct PMR matchups |
| Recent form | 30 % (20 % under H2H_PRIORITY) | last 12 matches with recency × tier × dominance |
| Tournament tier context | 10 % (when both players have data) | per-tier winrate split |
| Inactivity / rust | additive logit penalty | days since last match |
| Opponent strength | multiplier 0.4–1.6 | true winrate of past opponents |

All blending happens in logit space. Output is clamped by confidence-tier
(0.70 / 0.80 / 0.87 / 0.92). House margin 9 % overround applied last.

## Variant catalog

> Raw leaderboard data : `audit/ODDS_RESULTS_FULL_2026-05-02.md` (36 variants),
> `audit/ODDS_RESULTS_V37_V46_2026-05-02.md` (46 variants).

### Variants currently in prod

| Variant | Flag | Status |
|---------|------|--------|
| baseline V1 | `ODDS_ENGINE_V2_ENABLED=false` | live, default |
| Exact-score V2 | `ODDS_ENGINE_EXACT_V2_ENABLED=true` | live since 2026-04-19 |

### Variants behind feature flag (NOT YET on)

| Variant | Flag | Backtest Brier | vs baseline | Recommended next |
|---------|------|----------------|-------------|------------------|
| `v45-bayes-weak-h2h` | `ODDS_ENGINE_BAYES_WEAK_H2H` | **0.1897** | -0.0164 | Activate after 24-48 h side-by-side via weekly backtest cron |
| `s2-combo-h2h-priority` | `ODDS_ENGINE_H2H_PRIORITY` | 0.1909 | -0.0152 | Subsumed by v45 — keep flag for granular A/B but prefer v45 |

### Variants tested + abandoned

Sorted by Brier (best to worst). `Δ` = relative to baseline 0.2061.
Variants worse than baseline kept in the harness as negative-signal evidence.

| Variant | Brier | Δ | Notes / why abandoned |
|---------|------:|---:|------------------------|
| `v45-bayes-weak-h2h` | 0.1897 | -0.0164 | **session 3 winner — kept** |
| `s2-combo-h2h-priority` | 0.1909 | -0.0152 | session 2 winner — kept (subsumed) |
| `v40-anti-farm-h2h` | 0.1909 | -0.0152 | identical to session-2 winner — opp-strength tweaks have NO effect on top of h2h-priority. Drop the SOS bits in any future combo. |
| `v44-combo-h2h-tier-streak` | 0.1959 | -0.0102 | tier-context boost + streak adds noise to v45 — abandoned |
| `form-weight-0` | 0.1960 | -0.0101 | suggests form factor is noise, not signal. Investigate what's wrong with computeFormFactor. |
| `s2-no-form-no-streak` | 0.2004 | -0.0057 | confirms form is noise but tier-context boost added doesn't help |
| `h2h-weight-0.50` | 0.2010 | -0.0051 | partial of session-2 winner |
| `v43-format-match-boost` | 0.2012 | -0.0049 | **highest accuracy 75.8 %** but mediocre Brier — over-confident on the wrong side. Worth re-investigating with calibration |
| `equal-weights` | 0.2030 | -0.0031 | adaptive blend mostly OK |
| `s2-prior-weak` | 0.2046 | -0.0015 | Acc 75.2 % — accuracy gain that v45 captures more cleanly |
| `v37-tier-context-boost` | 0.2124 | +0.0063 | **boosting tier-context to 0.40 hurts**. Drop. |
| `v38-streak-decay-aggressive` | 0.2061 | 0.0000 | streak detector at 5 matches is null — doesn't trigger enough on this dataset |
| `v39-opp-strength-extreme` | 0.2061 | 0.0000 | SOS doesn't trigger because most matches lack `sosMinMatches`. SOS feature is effectively dead — drop or fix the threshold. |
| `v41-patch-reset-2026-04` | 0.2070 | +0.0009 | no significant patch effect detected. Kept as a knob in case we want to investigate specific patches later. |
| `v42-consistency-shrink` | 0.2063 | +0.0002 | shrinkage doesn't help — players' variance signal is too weak |
| `glicko-on` / `glicko-plus-v2` / `s2-combo-skill-driven` | 0.24+ | +0.03+ | Glicko consistently degrades the model on sparse data. Confirms PHASE3 conclusion : RD > 150 makes ratings noisy. |

### Ensemble — `v46_ensemble.ts`

Weighted average of the top-5 individual variants by inverse-Brier weighting.
Result : Brier 0.1921 — better than baseline (0.2061) but **worse than v45 alone**
(0.1897). Diversification didn't help here because the top-5 share most of the
H2H-priority signal.

**Verdict** : skip the ensemble layer. Single-best variant wins.

## Testing process — adding a new variant

### Pure-hyperparam variant (no engine code change)

1. Edit `backend/scripts/odds-experiments/variants.ts`. Append a new entry :
   ```ts
   {
     id: 'my-variant',
     description: 'Hypothesis : <…>. Effect : <…>.',
     overrides: { someHyperparam: <value> },
   }
   ```
2. Run :
   ```bash
   cd backend
   # if you don't already have a snapshot :
   DATABASE_URL=<pooler URL> npx tsx scripts/odds-experiments/snapshot-data.ts
   npx tsx scripts/odds-experiments/run-all.ts
   npx tsx scripts/odds-experiments/analyze-roi.ts
   ```
3. Read the leaderboard in `audit/ODDS_LEADERBOARD_<date>.md` and the comparative
   table in `audit/ODDS_RESULTS_FULL_<date>.md`.

### Variant requiring new engine math

1. Add the new field to `Hyperparams` in
   `backend/scripts/odds-experiments/tunable-engine.ts`.
2. Set its default in `DEFAULT_HYPERPARAMS` to a no-op value (so existing
   variants keep behaving identically).
3. Wire the field into the relevant compute function (`compWinrate`, `compH2H`,
   `compForm`, `compRust`, or the blend stage).
4. Add the variant to `variants.ts` overriding the new field.
5. Run as above.
6. **Tests** : if the new compute is non-trivial (variance, time bucketing,
   etc.), add a unit test in `backend/src/services/odds/__tests__/` using
   `node:test` (cf. `exactScore.test.ts`). Run with
   `npx tsx --test src/services/odds/__tests__/<file>.test.ts`.

### Promoting a variant to a prod feature flag

1. Variant must beat the baseline on at least 2 of {Brier, ECE, Accuracy}.
2. Add a `ODDS_ENGINE_<FLAG_NAME>` env var in `oddsEngine.ts` with a default
   of `false` (toggleable via Railway).
3. Wire the variant's overrides into the engine constants (cf. how
   `ODDS_ENGINE_H2H_PRIORITY` and `ODDS_ENGINE_BAYES_WEAK_H2H` are wired).
4. Document in `.env.example` with the backtest delta.
5. **Do NOT auto-enable.** Leave to the operator to flip after monitoring.

## Roadmap

### Top features to add (by expected impact)

| # | Feature | Effort | Expected gain | Why |
|---|---------|--------|---------------|-----|
| 1 | **Civ × map data ingest** | 4-6 h schema + scraper | unknown — could be huge | Per-game civ + map exists in `BoResult` schema but is **completely empty** (0 rows). Ingest from Liquipedia per-game wikitext or aoe4world.com replay parse. Unblocks v37-style variants AND the `simulateExactScore` `perMapProb` option |
| 2 | **Investigate form factor noise** | 1-2 h | up to -0.01 Brier | `form-weight-0` beats baseline by 0.0101. Either fix `computeFormFactor` or downweight it permanently |
| 3 | **Larger sample window** | passive | tightens all error bars | At N=153 every Brier delta < 0.005 is noise. Wait for N > 250 (~1 month of tournaments) before promoting more variants |
| 4 | **Calibrate `v43-format-match-boost`** | 1 h | maybe -0.005 Brier | Variant has Acc 75.8 % (best in field) but Brier 0.2012 — overconfident. Add isotonic calibration on the format-boosted prediction |
| 5 | **Player-region-aware "home advantage"** | 2-3 h | uncertain | Player.country exists ; need match-region/timezone in Match. Could explain hour-of-day effects |
| 6 | **Patch-effect detection** | 1 h ongoing | -0.005 Brier per significant patch | `v41-patch-reset-2026-04` was null but only because the patch date was a guess. Hardcode real Microsoft patch dates as they ship |

### In-progress / blocked

| Item | Status | Blocker |
|------|--------|---------|
| Civ matchup matrix | designed, not started | needs data ingest #1 above |
| Map preference per player | designed, not started | needs data ingest #1 above |
| Per-map odds via `simulateExactScore` perMapProb | code ready (`exactScore.ts`) | needs data ingest #1 above |
| Real-time momentum (within-match) | not designed | needs aoe4world live game polling already present in scraper |

### Open investigations

- **Why does `form-weight-0` beat baseline ?** The form factor includes draw
  handling, dominance, tier weighting — one of these is doing the wrong
  thing on the current dataset. Worth running `formMaxLogit` and
  `formPerMatchDecay` ablations.
- **Glicko fundamentally broken on sparse data** : RD > 150 produces noisy
  ratings. Either fix the RD inflation curve or shelve Glicko until N > 500.
- **Ensemble disappointment** : top-5 share too much variance. Could try
  ensembling deliberately-different families (skill vs h2h vs form), not
  best-N.

## Rollback procedure

If a flag turns sour in prod :

```bash
# Easiest : unset the env var on Railway, restart service
railway variables unset ODDS_ENGINE_BAYES_WEAK_H2H
# (or set explicitly to false)
```

If the engine code itself needs rolling back :

```bash
git revert -m 1 <merge-commit-hash>   # eb88099 for v-odds-overnight-2
git push origin master
```
