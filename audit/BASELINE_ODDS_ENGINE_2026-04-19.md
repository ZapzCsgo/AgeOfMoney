# Baseline backtest — odds engine (2026-04-19)

Matches analysés: **30** (dont 4 draws exclus du Brier)

## Métriques globales (binaires, hors draws)
- **Brier score** : **0.2501** (cible < 0.20 ; baseline 50/50 = 0.25)
- **Log-loss** : 0.6907 (baseline 50/50 = 0.6931 = 0.6931)
- **Top-choice accuracy** : 42.3% (le favori a gagné)
- **Book ROI simulé** : 11.32% (flat-bet symétrique, positif = house edge)
- **Overround 2-way** : min 1.0589 / median 1.0901 / max 1.0923

## Par format
| Format | n | Brier | Accuracy |
|---|---|---|---|
| BO2 | 1 | 0.0618 | 100.0% |
| BO5 | 25 | 0.2576 | 40.0% |

## Calibration curve (reliability diagram)
Pour chaque bucket de prob prédite, le taux réel de victoire P1. Un modèle bien calibré → actual ≈ predicted.

| Bucket | Predicted | Actual | n |
|---|---|---|---|
| 30-40% | 37.2% | 100.0% | 4 |
| 40-50% | 47.5% | 83.3% | 6 |
| 50-60% | 53.7% | 33.3% | 6 |
| 60-70% | 65.7% | 71.4% | 7 |
| 70-80% | 76.9% | 100.0% | 3 |

## Matches avec erreur de prédiction la plus grande
(abs(prob1 - outcome) > 0.5 — le modèle s'est fortement trompé)

| Match | Format | Tier | Pred P1 | Outcome | Err |
|---|---|---|---|---|---|
| Hearttt vs Dark | BO5 | S | 69.8% | P2 wins | 69.8% |
| Lewis vs KingstoNe | BO5 | S | 67.3% | P2 wins | 67.3% |
| Lucho vs StonePleaseAoE | BO5 | S | 34.1% | P1 wins | 65.9% |
| Barles vs JorDan AoE | BO5 | S | 36.4% | P1 wins | 63.6% |
| Beastyqt vs Myriad | BO5 | A | 39.1% | P1 wins | 60.9% |
| Vinchester vs Vivi | BO5 | S | 39.4% | P1 wins | 60.6% |
| DauT vs Sora Kuma | BO5 | S | 57.6% | P2 wins | 57.6% |
| Wam01 vs Beastyqt | BO5 | A | 55.4% | P2 wins | 55.4% |
| VortiX vs Bee | BO5 | A | 46.2% | P1 wins | 53.8% |
| Bee vs Corvinus1 | BO5 | A | 47.1% | P1 wins | 52.9% |