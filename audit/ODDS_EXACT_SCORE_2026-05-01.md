# Exact-score backtest — v36 Monte Carlo vs analytical (2026-05-01)

Snapshot : 2026-05-01T20:51:44.445Z
Predictions : 143 (BO3=18 BO5=119 BO7=6)
MC sims per prediction : 10 000 (seed 42, deterministic)

## Results by format

| Format | Method | Brier (multi) ↓ | Log loss ↓ | Top-1 acc ↑ | n |
|--------|--------|-----------------|------------|-------------|---|
| BO3 | analytical | 0.6395 | 2.2373 | 38.9% | 18 |
| BO3 | monteCarlo | 0.6407 | 2.2399 | 38.9% | 18 |
| BO5 | analytical | 0.7794 | 2.0432 | 20.2% | 119 |
| BO5 | monteCarlo | 0.7841 | 2.0572 | 18.5% | 119 |
| BO7 | analytical | 0.8313 | 1.8905 | 16.7% | 6 |
| BO7 | monteCarlo | 0.8330 | 1.8964 | 16.7% | 6 |

## All formats combined
- analytical : Brier 0.7639, LL 2.0612, Top-1 22.4%
- monteCarlo : Brier 0.7681, LL 2.0735, Top-1 21.0%

## Verdict

MC and analytical agree within Brier 0.005 — expected, since with iid `pPerGame` the MC is a noisy estimator of the closed form. Use analytical in prod (zero variance, no PRNG, faster).

Real upside of MC kicks in once `perMapProb` is wired (per-game data needed — schema work : add Game.civ + Game.map per BO game in PMR).