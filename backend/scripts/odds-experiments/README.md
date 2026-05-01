# Odds Engine Variants Harness

A/B test variations of `oddsEngine.calculateOddsV2` against the production
baseline, using held-out chronological backtesting on completed matches.

## Quick start

```bash
cd backend

# 1. (one-time, when DB is reachable) snapshot the data
npx tsx scripts/odds-experiments/snapshot-data.ts

# 2. run all variants
npx tsx scripts/odds-experiments/run-all.ts

# Optional flags:
#   --n=200            measurement window size (default 200 most recent)
#   --filter=a,b       run only specified variant ids
npx tsx scripts/odds-experiments/run-all.ts --n=500 --filter=baseline,glicko-on
```

## Output

- `audit/ODDS_LEADERBOARD_<date>.md` — ranked variants table
- `audit/ODDS_VARIANTS_<date>.json` — full per-prediction dump
- `backend/scripts/odds-experiments/.snapshot.json` — local data cache (gitignored)

## Adding a variant

Edit `variants.ts` :

```ts
{
  id: 'my-experiment',
  description: 'What we\'re testing.',
  overrides: { halfLifeDays: 120, formWeight: 0.25 },
}
```

Then re-run `run-all.ts`. No need to re-snapshot.

## Files

- `tunable-engine.ts` — clone of `calculateOddsV2` with every magic number exposed via `Hyperparams`
- `variants.ts` — list of `{id, description, overrides}` to A/B test
- `snapshot-data.ts` — dumps PMR + matches once to `.snapshot.json`
- `run-all.ts` — runs every variant chronologically (no leak), writes leaderboard

## Methodology

- **No data leakage** : for each match in the window, only PMR rows with `matchDate < match.scheduledAt` are visible.
- **Glicko-2 ratings** are replayed in-memory chronologically from the start of the snapshot, with RD inflation for inactivity.
- **Draws excluded** from Brier / Log Loss / ECE — they're a separate market (void-on-draw refund), not a binary outcome.
- **ECE** = expected calibration error on 10 buckets, weighted by bucket size.
- **Baseline** = the exact production engine path with `V2_ENABLED=false` and Glicko off, so a `Δ Brier` of 0 means the variant matches prod.

## Stretch goals

- Brier < 0.20
- Log Loss < 0.55
- ECE < 0.05
- Accuracy > 70%
