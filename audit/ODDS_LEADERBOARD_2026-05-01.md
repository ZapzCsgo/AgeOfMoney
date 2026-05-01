# Odds Engine — Variants Leaderboard (2026-05-01)

Métriques calculées sur les 153 derniers matchs COMPLETED non-draw, chronologique, no leak.

Snapshot : 2026-05-01T21:20:19.078Z


| Rank | Variant ID | Brier ↓ | Log Loss ↓ | ECE ↓ | Accuracy ↑ | Δ Brier vs baseline | Notes |
|------|-----------|---------|------------|-------|------------|---------------------|-------|
| 1 | `v45-bayes-weak-h2h` | 0.1897 | 0.5645 | 0.1932 | 73.2% | -0.0164 | Prior weak (1 pseudo-match) + h2h priority overrides. Test si on garde Acc 75% + Brier amélioré. |
| 2 | `s2-combo-h2h-priority` | 0.1909 | 0.5670 | 0.1951 | 72.5% | -0.0152 | H2H scale 0.50 + h2hConfidenceMaxAt 6 (boost rapide) + form 0.20. Pour matchups récurrents. |
| 3 | `v40-anti-farm-h2h` | 0.1909 | 0.5670 | 0.1951 | 72.5% | -0.0152 | v39 (anti-farm) + h2h priority weights from winner. Combine corrections. |
| 4 | `v44-combo-h2h-tier-streak` | 0.1959 | 0.5779 | 0.2018 | 71.9% | -0.0102 | h2h priority + tier-context 0.30 + streak ON. Combine les 3 signaux du leaderboard session 2. |
| 5 | `form-weight-0` | 0.1960 | 0.5789 | 0.1997 | 71.2% | -0.0101 | Form OFF. Test si la form factor fait du bruit ou du signal. |
| 6 | `s2-no-form-no-streak` | 0.2004 | 0.5882 | 0.2041 | 69.9% | -0.0057 | Form OFF + tier-context boost à 0.20. Pour tester si le facteur form ajoute du signal réel ou seulement du bruit. |
| 7 | `h2h-weight-0.50` | 0.2010 | 0.5896 | 0.2064 | 71.2% | -0.0051 | H2H scale 0.50 (vs 0.30 baseline). Donne plus de poids aux matchups directs. |
| 8 | `v43-format-match-boost` | 0.2012 | 0.5902 | 0.2110 | 75.8% | -0.0049 | Records du même format BO que le match courant comptent ×2.0. Test la spécialisation BO3/BO5. |
| 9 | `equal-weights` | 0.2030 | 0.5938 | 0.2082 | 69.9% | -0.0031 | 25/25/25/25 wr/h2h/form/tier (when available). Pour tester si l'adaptive blend ajoute de la valeur. |
| 10 | `form-weight-0.20` | 0.2032 | 0.5946 | 0.2090 | 71.2% | -0.0029 | Form 20% (vs 30% baseline). Less hot-streak influence. |
| 11 | `s2-prior-weak` | 0.2046 | 0.5978 | 0.2304 | 75.2% | -0.0015 | Bayesian prior faible (1 pseudo-match). Laisse l'observation parler dès la 5e partie. |
| 12 | `form-last-25` | 0.2051 | 0.5987 | 0.2118 | 73.9% | -0.0010 | Form sur 25 matchs. Lisse le bruit. |
| 13 | `half-life-365d` | 0.2053 | 0.5991 | 0.2094 | 72.5% | -0.0008 | Plus lent — half-life 1 an. Pour joueurs avec longue carrière. |
| 14 | `v2-momentum-only` | 0.2061 | 0.6006 | 0.2116 | 72.5% | -0.0000 | V2 momentum (streak detector) seul. |
| 15 | `s2-streak-conservative` | 0.2061 | 0.6006 | 0.2118 | 71.9% | -0.0000 | Streak bonus 0.03 (cap 0.15). Réduit le bruit des petites séries. |
| 16 | `looser-clamps` | 0.2061 | 0.6006 | 0.2121 | 71.9% | -0.0000 | Max prob plus large (jusqu'à 0.95). Plus confiant sur les gros favoris. |
| 17 | `baseline` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Production V1 (V2_ENABLED=false, no Glicko) — reference. |
| 18 | `no-house-margin` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Margin 0% — vraies probas, pour mesurer Brier sans biais bookmaker. |
| 19 | `v2-sos-only` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | V2 strength-of-schedule seul. |
| 20 | `s2-anti-farm` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | SOS scale 1.5 + opponent strength stretch (a=0.3, b=1.4). Pénalise farm vs faibles. |
| 21 | `v39-opp-strength-extreme` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Opp strength a=0.2 b=1.6 + SOS 1.5 cap 0.25. Pénalise très fort le farm. |
| 22 | `v46-ensemble-placeholder` | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.0000 | Placeholder — voir variants/v46_ensemble.ts pour l'orchestrateur réel. |
| 23 | `s2-streak-aggressive` | 0.2061 | 0.6006 | 0.2075 | 73.9% | 0.0000 | Streak bonus 0.10 par win consécutive (cap 0.50). Capture les hot-streaks plus vite. |
| 24 | `v38-streak-decay-aggressive` | 0.2061 | 0.6006 | 0.2075 | 73.9% | 0.0000 | Streak ON + bonus 0.10 par win consécutive (cap 0.50) + streakWindow 5. Capture les hot streaks. |
| 25 | `form-last-6` | 0.2063 | 0.6012 | 0.2138 | 72.5% | 0.0002 | Form sur les 6 derniers matchs (vs 12). Réagit plus vite aux switchs. |
| 26 | `v42-consistency-shrink` | 0.2063 | 0.6013 | 0.2126 | 71.9% | 0.0002 | Si les 2 joueurs ont variance < 0.20 sur 20 derniers, shrink prob vers 0.5 (×0.10 logit). Anti-overconfidence. |
| 27 | `tighter-clamps` | 0.2064 | 0.6017 | 0.2129 | 71.9% | 0.0003 | Max prob plus serrée (0.85 max even at high confidence). Plus prudent. |
| 28 | `s2-margin-zero` | 0.2065 | 0.6022 | 0.2133 | 71.9% | 0.0004 | Margin 0% + tighter clamps (0.85 max). Mesure pure de la calibration sans biais bookmaker. |
| 29 | `wr-heavy` | 0.2066 | 0.6019 | 0.2122 | 72.5% | 0.0005 | 60% wr, 20% form, 20% h2h. Confiance accrue dans la baseline statistique. |
| 30 | `v2-flag-on` | 0.2067 | 0.6012 | 0.2074 | 69.9% | 0.0006 | V2 entier (half-life 90d, wrLogitScale 1.15, momentum, rust v2, SOS). |
| 31 | `half-life-90d` | 0.2070 | 0.6022 | 0.2118 | 69.9% | 0.0009 | V2 default — half-life 90d (records 3mo = 0.5×). Pénalise davantage les anciens matchs. |
| 32 | `v41-patch-reset-2026-04` | 0.2070 | 0.6026 | 0.2143 | 71.9% | 0.0009 | Patch reset 2026-04-01 → poids ×0.50 sur les records pré-patch. Test si la meta a tourné. |
| 33 | `half-life-60d` | 0.2073 | 0.6024 | 0.2135 | 71.2% | 0.0012 | Plus agressif — half-life 60d. Privilégie le très récent. |
| 34 | `s2-prior-asym` | 0.2076 | 0.6038 | 0.2126 | 71.2% | 0.0015 | Prior asymétrique 0.45 + strength 8. Anti-favorite — corrige le biais "tout le monde gagne plus que prévu". |
| 35 | `s2-prior-strong` | 0.2080 | 0.6048 | 0.2149 | 71.9% | 0.0019 | Bayesian prior fort (15 pseudo-matchs à 50%). Tire fort vers même money quand data sparse. |
| 36 | `s2-half-life-30d` | 0.2080 | 0.6034 | 0.2216 | 73.2% | 0.0019 | Half-life 30 jours. Sweet spot probable entre 14d (overfit) et 90d (slow). |
| 37 | `s2-platt-like` | 0.2082 | 0.6055 | 0.2160 | 71.9% | 0.0021 | WR scale 0.85 (compresse vers 0.5). Approxime un Platt scaling sur le facteur skill. |
| 38 | `form-weight-0.40` | 0.2085 | 0.6059 | 0.2147 | 71.2% | 0.0024 | Form 40%. Plus de poids pour les hot-streaks récents. |
| 39 | `s2-half-life-14d` | 0.2095 | 0.6069 | 0.2229 | 72.5% | 0.0034 | Half-life 14 jours. Forme récente ultra-dominante. |
| 40 | `s2-combo-recent-form` | 0.2104 | 0.6087 | 0.2228 | 70.6% | 0.0043 | Half-life 30d + form weight 0.40 + streak ON. "Le passé proche prime, et les streaks comptent." |
| 41 | `s2-half-life-7d` | 0.2114 | 0.6119 | 0.2237 | 71.2% | 0.0053 | Half-life 7 jours. Très agressif — quasi seulement la dernière semaine compte. |
| 42 | `v37-tier-context-boost` | 0.2124 | 0.6139 | 0.2160 | 69.3% | 0.0063 | tierCtxWeight 0.10 → 0.40 + step-up penalty x1.4. Tier-context devient un facteur primaire. |
| 43 | `h2h-weight-0` | 0.2177 | 0.6254 | 0.2235 | 68.6% | 0.0116 | H2H OFF. Test si H2H apporte du signal ou s'il est noyé par les autres facteurs. |
| 44 | `glicko-plus-v2` | 0.2358 | 0.6664 | 0.2180 | 61.4% | 0.0297 | Glicko + V2 features combinés. |
| 45 | `glicko-on` | 0.2385 | 0.6729 | 0.2204 | 60.1% | 0.0324 | Glicko-2 enabled (uses ratings as wr signal). Baseline V1 elsewhere. |
| 46 | `s2-combo-skill-driven` | 0.2415 | 0.6789 | 0.2441 | 59.5% | 0.0354 | Glicko + half-life 60d + WR-heavy + step-up 0.35. Skill model maximisé. |

_baseline = oddsEngine.ts actuel (V2_ENABLED=false, no Glicko)_


## Stretch goals

- Brier < 0.20
- Log Loss < 0.55
- ECE < 0.05
- Accuracy > 70%

## Top 3

1. **`v45-bayes-weak-h2h`** — Brier 0.1897, Acc 73.2%, ECE 0.1932.  Prior weak (1 pseudo-match) + h2h priority overrides. Test si on garde Acc 75% + Brier amélioré.
2. **`s2-combo-h2h-priority`** — Brier 0.1909, Acc 72.5%, ECE 0.1951.  H2H scale 0.50 + h2hConfidenceMaxAt 6 (boost rapide) + form 0.20. Pour matchups récurrents.
3. **`v40-anti-farm-h2h`** — Brier 0.1909, Acc 72.5%, ECE 0.1951.  v39 (anti-farm) + h2h priority weights from winner. Combine corrections.

## Méthodologie

- Dataset : snapshot des matchs COMPLETED avec winnerId/resultScore non-null
- Train/test split : chronologique, fenêtre de mesure = 153 derniers matchs valides
- Aucun match du measurement window n'est utilisé pour entraîner (PMR strict avant `match.scheduledAt`)
- Brier : `(p - y)²` moyenné sur les matchs avec outcome != draw
- Log Loss : `-[y log p + (1-y) log (1-p)]` clip [0.001, 0.999]
- ECE : Expected Calibration Error sur 10 buckets, weighted by bucket size
- Glicko-2 ratings replayés in-memory depuis le début du dataset, RD inflé en cas d'inactivité