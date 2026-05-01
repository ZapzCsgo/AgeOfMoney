# Odds Engine — Variants Leaderboard (2026-05-01)

Métriques calculées sur les 153 derniers matchs COMPLETED non-draw, chronologique, no leak.

Snapshot : 2026-05-01T20:51:44.445Z


| Rank | Variant ID | Brier ↓ | Log Loss ↓ | ECE ↓ | Accuracy ↑ | Δ Brier vs baseline | Notes |
|------|-----------|---------|------------|-------|------------|---------------------|-------|
| 1 | `form-weight-0` | 0.1960 | 0.5789 | 0.1997 | 71.2% | -0.0101 | Form OFF. Test si la form factor fait du bruit ou du signal. |
| 2 | `h2h-weight-0.50` | 0.2010 | 0.5896 | 0.2064 | 71.2% | -0.0051 | H2H scale 0.50 (vs 0.30 baseline). Donne plus de poids aux matchups directs. |
| 3 | `equal-weights` | 0.2030 | 0.5938 | 0.2082 | 69.9% | -0.0031 | 25/25/25/25 wr/h2h/form/tier (when available). Pour tester si l'adaptive blend ajoute de la valeur. |
| 4 | `form-weight-0.20` | 0.2032 | 0.5946 | 0.2090 | 71.2% | -0.0029 | Form 20% (vs 30% baseline). Less hot-streak influence. |
| 5 | `form-last-25` | 0.2051 | 0.5987 | 0.2118 | 73.9% | -0.0010 | Form sur 25 matchs. Lisse le bruit. |
| 6 | `half-life-365d` | 0.2053 | 0.5991 | 0.2094 | 72.5% | -0.0008 | Plus lent — half-life 1 an. Pour joueurs avec longue carrière. |
| 7 | `v2-momentum-only` | 0.2061 | 0.6006 | 0.2116 | 72.5% | -0.0000 | V2 momentum (streak detector) seul. |
| 8 | `looser-clamps` | 0.2061 | 0.6006 | 0.2121 | 71.9% | -0.0000 | Max prob plus large (jusqu'à 0.95). Plus confiant sur les gros favoris. |
| 9 | `baseline` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Production V1 (V2_ENABLED=false, no Glicko) — reference. |
| 10 | `no-house-margin` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Margin 0% — vraies probas, pour mesurer Brier sans biais bookmaker. |
| 11 | `v2-sos-only` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | V2 strength-of-schedule seul. |
| 12 | `form-last-6` | 0.2063 | 0.6012 | 0.2138 | 72.5% | 0.0002 | Form sur les 6 derniers matchs (vs 12). Réagit plus vite aux switchs. |
| 13 | `tighter-clamps` | 0.2064 | 0.6017 | 0.2129 | 71.9% | 0.0003 | Max prob plus serrée (0.85 max even at high confidence). Plus prudent. |
| 14 | `wr-heavy` | 0.2066 | 0.6019 | 0.2122 | 72.5% | 0.0005 | 60% wr, 20% form, 20% h2h. Confiance accrue dans la baseline statistique. |
| 15 | `v2-flag-on` | 0.2067 | 0.6012 | 0.2074 | 69.9% | 0.0006 | V2 entier (half-life 90d, wrLogitScale 1.15, momentum, rust v2, SOS). |
| 16 | `half-life-90d` | 0.2070 | 0.6022 | 0.2118 | 69.9% | 0.0009 | V2 default — half-life 90d (records 3mo = 0.5×). Pénalise davantage les anciens matchs. |
| 17 | `half-life-60d` | 0.2073 | 0.6024 | 0.2135 | 71.2% | 0.0012 | Plus agressif — half-life 60d. Privilégie le très récent. |
| 18 | `form-weight-0.40` | 0.2085 | 0.6059 | 0.2147 | 71.2% | 0.0024 | Form 40%. Plus de poids pour les hot-streaks récents. |
| 19 | `h2h-weight-0` | 0.2177 | 0.6254 | 0.2235 | 68.6% | 0.0116 | H2H OFF. Test si H2H apporte du signal ou s'il est noyé par les autres facteurs. |
| 20 | `glicko-plus-v2` | 0.2358 | 0.6664 | 0.2180 | 61.4% | 0.0297 | Glicko + V2 features combinés. |
| 21 | `glicko-on` | 0.2385 | 0.6729 | 0.2204 | 60.1% | 0.0324 | Glicko-2 enabled (uses ratings as wr signal). Baseline V1 elsewhere. |

_baseline = oddsEngine.ts actuel (V2_ENABLED=false, no Glicko)_


## Stretch goals

- Brier < 0.20
- Log Loss < 0.55
- ECE < 0.05
- Accuracy > 70%

## Top 3

1. **`form-weight-0`** — Brier 0.1960, Acc 71.2%, ECE 0.1997.  Form OFF. Test si la form factor fait du bruit ou du signal.
2. **`h2h-weight-0.50`** — Brier 0.2010, Acc 71.2%, ECE 0.2064.  H2H scale 0.50 (vs 0.30 baseline). Donne plus de poids aux matchups directs.
3. **`equal-weights`** — Brier 0.2030, Acc 69.9%, ECE 0.2082.  25/25/25/25 wr/h2h/form/tier (when available). Pour tester si l'adaptive blend ajoute de la valeur.

## Méthodologie

- Dataset : snapshot des matchs COMPLETED avec winnerId/resultScore non-null
- Train/test split : chronologique, fenêtre de mesure = 153 derniers matchs valides
- Aucun match du measurement window n'est utilisé pour entraîner (PMR strict avant `match.scheduledAt`)
- Brier : `(p - y)²` moyenné sur les matchs avec outcome != draw
- Log Loss : `-[y log p + (1-y) log (1-p)]` clip [0.001, 0.999]
- ECE : Expected Calibration Error sur 10 buckets, weighted by bucket size
- Glicko-2 ratings replayés in-memory depuis le début du dataset, RD inflé en cas d'inactivité