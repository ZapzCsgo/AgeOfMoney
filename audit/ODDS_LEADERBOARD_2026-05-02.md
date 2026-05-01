# Odds Engine — Variants Leaderboard (2026-05-02 overnight)

Métriques calculées sur les 200 derniers matchs COMPLETED, chronologique, no leak.

| Rank | Variant ID | Brier ↓ | Log Loss ↓ | Calibration ECE ↓ | Accuracy ↑ | Δ Brier vs baseline | Notes |
|------|-----------|---------|------------|-------------------|------------|---------------------|-------|

_baseline = oddsEngine.ts actuel (V2_ENABLED=false, no Glicko)_

## Stretch goals

- Brier < 0.20
- Log Loss < 0.55
- ECE < 0.05
- Accuracy > 70%

## Top 3 (à remplir)

1. _TBD_
2. _TBD_
3. _TBD_

## Méthodologie

- Dataset : `prisma.match` `status=COMPLETED` avec winnerId ou resultScore non-null
- Train/test split : chronologique, fenêtre de mesure = 200 derniers matchs (configurable via `--n=N`)
- Aucun match du measurement window n'est utilisé pour entraîner (PMR strict avant `match.scheduledAt`)
- Brier : `(p - y)²` moyenné sur les matchs avec outcome != draw
- Log Loss : `-[y log p + (1-y) log (1-p)]` clip [0.001, 0.999]
- ECE : Expected Calibration Error sur 10 buckets, weighted by bucket size
