# Baseline backtest — odds engine (2026-04-19)

Matches analysés: **30** (dont 4 draws exclus du Brier)

## Métriques globales (binaires, hors draws)
- **Brier score** : **0.2372** (cible < 0.20 ; baseline 50/50 = 0.25)
- **Log-loss** : 0.6651 (baseline 50/50 = 0.6931 = 0.6931)
- **Top-choice accuracy** : 57.7% (le favori a gagné)
- **Book ROI simulé** : 11.32% (flat-bet symétrique, positif = house edge)
- **Overround 2-way** : min 1.0589 / median 1.0901 / max 1.0923

## Par format
| Format | n | Brier | Accuracy |
|---|---|---|---|
| BO2 | 1 | 0.1007 | 100.0% |
| BO5 | 25 | 0.2427 | 56.0% |

## Calibration curve (reliability diagram)
Pour chaque bucket de prob prédite, le taux réel de victoire P1. Un modèle bien calibré → actual ≈ predicted.

| Bucket | Predicted | Actual | n |
|---|---|---|---|
| 30-40% | 38.0% | 100.0% | 3 |
| 40-50% | 45.2% | 66.7% | 3 |
| 50-60% | 53.8% | 60.0% | 10 |
| 60-70% | 64.1% | 75.0% | 8 |
| 70-80% | 76.8% | 100.0% | 2 |

## Matches avec erreur de prédiction la plus grande
(abs(prob1 - outcome) > 0.5 — le modèle s'est fortement trompé)

| Match | Format | Tier | Pred P1 | Outcome | Err |
|---|---|---|---|---|---|
| Lewis vs KingstoNe | BO5 | S | 69.5% | P2 wins | 69.5% |
| Barles vs JorDan AoE | BO5 | S | 37.2% | P1 wins | 62.8% |
| Vinchester vs Vivi | BO5 | S | 37.6% | P1 wins | 62.4% |
| Lucho vs StonePleaseAoE | BO5 | S | 39.1% | P1 wins | 60.9% |
| Hearttt vs Dark | BO5 | S | 60.1% | P2 wins | 60.1% |
| Beastyqt vs Myriad | BO5 | A | 42.5% | P1 wins | 57.5% |
| VortiX vs Bee | BO5 | A | 43.9% | P1 wins | 56.1% |
| DauT vs Sora Kuma | BO5 | S | 55.5% | P2 wins | 55.5% |
| MbL vs Running | BO5 | S | 53.3% | P2 wins | 53.3% |
| Capoch vs NeoZz | BO5 | S | 51.9% | P2 wins | 51.9% |