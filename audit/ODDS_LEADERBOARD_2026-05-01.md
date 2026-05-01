# Odds Engine — Variants Leaderboard (2026-05-01)

Métriques calculées sur les 153 derniers matchs COMPLETED non-draw, chronologique, no leak.

Snapshot : 2026-05-01T20:51:44.445Z


| Rank | Variant ID | Brier ↓ | Log Loss ↓ | ECE ↓ | Accuracy ↑ | Δ Brier vs baseline | Notes |
|------|-----------|---------|------------|-------|------------|---------------------|-------|
| 1 | `s2-combo-h2h-priority` | 0.1909 | 0.5670 | 0.1951 | 72.5% | -0.0152 | H2H scale 0.50 + h2hConfidenceMaxAt 6 (boost rapide) + form 0.20. Pour matchups récurrents. |
| 2 | `form-weight-0` | 0.1960 | 0.5789 | 0.1997 | 71.2% | -0.0101 | Form OFF. Test si la form factor fait du bruit ou du signal. |
| 3 | `s2-no-form-no-streak` | 0.2004 | 0.5882 | 0.2041 | 69.9% | -0.0057 | Form OFF + tier-context boost à 0.20. Pour tester si le facteur form ajoute du signal réel ou seulement du bruit. |
| 4 | `h2h-weight-0.50` | 0.2010 | 0.5896 | 0.2064 | 71.2% | -0.0051 | H2H scale 0.50 (vs 0.30 baseline). Donne plus de poids aux matchups directs. |
| 5 | `equal-weights` | 0.2030 | 0.5938 | 0.2082 | 69.9% | -0.0031 | 25/25/25/25 wr/h2h/form/tier (when available). Pour tester si l'adaptive blend ajoute de la valeur. |
| 6 | `form-weight-0.20` | 0.2032 | 0.5946 | 0.2090 | 71.2% | -0.0029 | Form 20% (vs 30% baseline). Less hot-streak influence. |
| 7 | `s2-prior-weak` | 0.2046 | 0.5978 | 0.2304 | 75.2% | -0.0015 | Bayesian prior faible (1 pseudo-match). Laisse l'observation parler dès la 5e partie. |
| 8 | `form-last-25` | 0.2051 | 0.5987 | 0.2118 | 73.9% | -0.0010 | Form sur 25 matchs. Lisse le bruit. |
| 9 | `half-life-365d` | 0.2053 | 0.5991 | 0.2094 | 72.5% | -0.0008 | Plus lent — half-life 1 an. Pour joueurs avec longue carrière. |
| 10 | `v2-momentum-only` | 0.2061 | 0.6006 | 0.2116 | 72.5% | -0.0000 | V2 momentum (streak detector) seul. |
| 11 | `s2-streak-conservative` | 0.2061 | 0.6006 | 0.2118 | 71.9% | -0.0000 | Streak bonus 0.03 (cap 0.15). Réduit le bruit des petites séries. |
| 12 | `looser-clamps` | 0.2061 | 0.6006 | 0.2121 | 71.9% | -0.0000 | Max prob plus large (jusqu'à 0.95). Plus confiant sur les gros favoris. |
| 13 | `baseline` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Production V1 (V2_ENABLED=false, no Glicko) — reference. |
| 14 | `v2-sos-only` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | V2 strength-of-schedule seul. |
| 15 | `no-house-margin` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Margin 0% — vraies probas, pour mesurer Brier sans biais bookmaker. |
| 16 | `s2-anti-farm` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | SOS scale 1.5 + opponent strength stretch (a=0.3, b=1.4). Pénalise farm vs faibles. |
| 17 | `s2-streak-aggressive` | 0.2061 | 0.6006 | 0.2075 | 73.9% | 0.0000 | Streak bonus 0.10 par win consécutive (cap 0.50). Capture les hot-streaks plus vite. |
| 18 | `form-last-6` | 0.2063 | 0.6012 | 0.2138 | 72.5% | 0.0002 | Form sur les 6 derniers matchs (vs 12). Réagit plus vite aux switchs. |
| 19 | `tighter-clamps` | 0.2064 | 0.6017 | 0.2129 | 71.9% | 0.0003 | Max prob plus serrée (0.85 max even at high confidence). Plus prudent. |
| 20 | `s2-margin-zero` | 0.2065 | 0.6022 | 0.2133 | 71.9% | 0.0004 | Margin 0% + tighter clamps (0.85 max). Mesure pure de la calibration sans biais bookmaker. |
| 21 | `wr-heavy` | 0.2066 | 0.6019 | 0.2122 | 72.5% | 0.0005 | 60% wr, 20% form, 20% h2h. Confiance accrue dans la baseline statistique. |
| 22 | `v2-flag-on` | 0.2067 | 0.6012 | 0.2074 | 69.9% | 0.0006 | V2 entier (half-life 90d, wrLogitScale 1.15, momentum, rust v2, SOS). |
| 23 | `half-life-90d` | 0.2070 | 0.6022 | 0.2118 | 69.9% | 0.0009 | V2 default — half-life 90d (records 3mo = 0.5×). Pénalise davantage les anciens matchs. |
| 24 | `half-life-60d` | 0.2073 | 0.6024 | 0.2135 | 71.2% | 0.0012 | Plus agressif — half-life 60d. Privilégie le très récent. |
| 25 | `s2-prior-asym` | 0.2076 | 0.6038 | 0.2126 | 71.2% | 0.0015 | Prior asymétrique 0.45 + strength 8. Anti-favorite — corrige le biais "tout le monde gagne plus que prévu". |
| 26 | `s2-prior-strong` | 0.2080 | 0.6048 | 0.2149 | 71.9% | 0.0019 | Bayesian prior fort (15 pseudo-matchs à 50%). Tire fort vers même money quand data sparse. |
| 27 | `s2-half-life-30d` | 0.2080 | 0.6034 | 0.2216 | 73.2% | 0.0019 | Half-life 30 jours. Sweet spot probable entre 14d (overfit) et 90d (slow). |
| 28 | `s2-platt-like` | 0.2082 | 0.6055 | 0.2160 | 71.9% | 0.0021 | WR scale 0.85 (compresse vers 0.5). Approxime un Platt scaling sur le facteur skill. |
| 29 | `form-weight-0.40` | 0.2085 | 0.6059 | 0.2147 | 71.2% | 0.0024 | Form 40%. Plus de poids pour les hot-streaks récents. |
| 30 | `s2-half-life-14d` | 0.2095 | 0.6069 | 0.2229 | 72.5% | 0.0034 | Half-life 14 jours. Forme récente ultra-dominante. |
| 31 | `s2-combo-recent-form` | 0.2104 | 0.6087 | 0.2228 | 70.6% | 0.0043 | Half-life 30d + form weight 0.40 + streak ON. "Le passé proche prime, et les streaks comptent." |
| 32 | `s2-half-life-7d` | 0.2114 | 0.6119 | 0.2237 | 71.2% | 0.0053 | Half-life 7 jours. Très agressif — quasi seulement la dernière semaine compte. |
| 33 | `h2h-weight-0` | 0.2177 | 0.6254 | 0.2235 | 68.6% | 0.0116 | H2H OFF. Test si H2H apporte du signal ou s'il est noyé par les autres facteurs. |
| 34 | `glicko-plus-v2` | 0.2358 | 0.6664 | 0.2180 | 61.4% | 0.0297 | Glicko + V2 features combinés. |
| 35 | `glicko-on` | 0.2385 | 0.6729 | 0.2204 | 60.1% | 0.0324 | Glicko-2 enabled (uses ratings as wr signal). Baseline V1 elsewhere. |
| 36 | `s2-combo-skill-driven` | 0.2415 | 0.6789 | 0.2441 | 59.5% | 0.0354 | Glicko + half-life 60d + WR-heavy + step-up 0.35. Skill model maximisé. |

_baseline = oddsEngine.ts actuel (V2_ENABLED=false, no Glicko)_


## Stretch goals

- Brier < 0.20
- Log Loss < 0.55
- ECE < 0.05
- Accuracy > 70%

## Top 3

1. **`s2-combo-h2h-priority`** — Brier 0.1909, Acc 72.5%, ECE 0.1951.  H2H scale 0.50 + h2hConfidenceMaxAt 6 (boost rapide) + form 0.20. Pour matchups récurrents.
2. **`form-weight-0`** — Brier 0.1960, Acc 71.2%, ECE 0.1997.  Form OFF. Test si la form factor fait du bruit ou du signal.
3. **`s2-no-form-no-streak`** — Brier 0.2004, Acc 69.9%, ECE 0.2041.  Form OFF + tier-context boost à 0.20. Pour tester si le facteur form ajoute du signal réel ou seulement du bruit.

## Méthodologie

- Dataset : snapshot des matchs COMPLETED avec winnerId/resultScore non-null
- Train/test split : chronologique, fenêtre de mesure = 153 derniers matchs valides
- Aucun match du measurement window n'est utilisé pour entraîner (PMR strict avant `match.scheduledAt`)
- Brier : `(p - y)²` moyenné sur les matchs avec outcome != draw
- Log Loss : `-[y log p + (1-y) log (1-p)]` clip [0.001, 0.999]
- ECE : Expected Calibration Error sur 10 buckets, weighted by bucket size
- Glicko-2 ratings replayés in-memory depuis le début du dataset, RD inflé en cas d'inactivité