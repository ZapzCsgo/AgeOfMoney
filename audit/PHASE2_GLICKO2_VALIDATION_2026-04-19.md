# Phase 2 Glicko-2 — validation backtest (2026-04-19)

## Recommandation : **Flag OFF, pas d'activation**

Glicko-2 a été implémenté proprement (test canonique du paper de Glickman PASS à 0.01 près sur les 3 métriques), les ratings top 25 sont cohérents avec la scene réelle (Beastyqt, Liereyy, MarineLorD, Chim Sẻ Đi Nắng, etc.), mais **le backtest chronologique montre V2 pire que V1** sur les 46 matchs valides.

## Résultats chiffrés (chronological replay, no data leakage)

| Métrique | V1 (heuristique) | V2 (Glicko-2) | Δ |
|---|---|---|---|
| **Brier score** | 0.2147 | **0.2543** | +0.0395 🔴 |
| **Log-loss** | 0.6203 | **0.7014** | +0.0811 🔴 |
| **Top-choice accuracy** | **71.7%** | 56.5% | -15.2pts 🔴 |

Note : V1 accuracy à 71.7% sur ce backtest chronologique propre > 57.7% du baseline initial (qui avait data leakage via ratings current). Le baseline initial était donc plus pessimiste qu'en réalité. V1 est en fait déjà relativement bon.

## Calibration par bucket

| Bucket | V1 pred | V1 actual | V2 pred | V2 actual | n_V2 |
|---|---|---|---|---|---|
| 20-30% | – | – | 30% | 100% | 1 |
| 30-40% | 36% | 75% | 38% | 71% | 7 |
| 40-50% | 45% | 44% | 45% | 67% | 12 |
| 50-60% | 54% | **80%** | 55% | **92%** | 13 |
| 60-70% | 65% | 82% | 63% | 50% | 8 |
| 70-80% | 73% | 100% | 74% | 80% | 5 |

V2 est sous-calibré dans le bucket 60-70% : prédit 63%, réel 50%. Plus d'erreurs quand Glicko est "confident".

## Top 10 joueurs par Glicko-2 rating (validation sanity check)

```
 1.  Beastyqt (AoE4)              2103
 2.  Liereyy (AoE2)               2082
 3.  MarineLorD (AoE4)            2076
 4.  Chim Sẻ Đi Nắng (AoE4)       1931
 5.  Wam01 (AoE4)                 1921
 6.  VortiX (AoE4)                1914
 7.  TheViper (AoE2)              1911
 8.  Yo (AoE2)                    1909
 9.  Sebastian (AoE2)             1900
10.  Bee (AoE4)                   1872
```

Ces ratings ont du sens — ce sont tous des vrais top pros. Le problème n'est donc **pas la qualité du rating Glicko lui-même**, mais la façon dont il est intégré dans le blending.

## Hypothèses pourquoi V2 sous-performe

1. **Single-game vs match-level** : Glicko modélise P(win d'un game). Notre engine traite wrProb1 comme match-level. Pour BO3/5, il y a un mismatch — Glicko sous-estime les favoris.
2. **Le blending dilue Glicko** : 50% WR (= Glicko) + 30% form + 30% H2H + 10% tier = seulement 50% du signal vient de Glicko. Le form et H2H noisy polluent.
3. **Sample trop petit** : 46 predictions valides. Un swing de 7 matchs sur la diagonale prob=0.5 change l'accuracy de 15pts. Potentiel bruit.
4. **Rebuild initial mais pas calibré** : les ratings sont reconstruits depuis toute l'histoire, mais avec tau=0.5 non calibré contre notre dataset AoE spécifique. Un backtest sur les 500 derniers pourrait montrer un autre comportement.

## Décisions

- ✅ **Flag `ODDS_ENGINE_V2_ENABLED` reste OFF en prod**. Aucun risque.
- ✅ Code Phase 2 reste committé et déployé sur master (`5eb6758`). Le hook de mise à jour des ratings est gated, donc quand le flag est OFF les ratings ne se mettent pas à jour — pas de pollution.
- ❌ Pas d'activation tant qu'un backtest sur ≥ 200 matchs valides confirme Brier < V1 **ET** Accuracy ≥ V1.

## Next steps possibles (Phase 3+)

1. **Convertir Glicko single-game → series-level** via binomiale. Plus honnête mathématiquement.
2. **Rebalancer le blending** quand Glicko est dispo : wrWeight 50% → 65%, form 30% → 20%, H2H 20% → 15%. Le Glicko est mieux calibré que l'heuristique, les autres facteurs devraient jouer les violons.
3. **Calibration post-hoc** (Platt scaling) : fit `sigmoid(a × logit(p) + b)` sur les 500 derniers matchs. Même si le modèle interne est biaisé, la calibration post-hoc peut aligner predicted sur actual.
4. **Agrandir la mesure** : relancer le backtest sur les 200+ derniers matchs une fois qu'on a plus de data en DB.
5. **Approche ensemble** : P(win) = 0.5 × V1 + 0.5 × V2 — voir si la moyenne bat les deux individuellement.

## Leçon

Un rating Glicko-2 correct (qui passe le test canonique + produit des top players crédibles) **ne garantit PAS** un meilleur moteur d'odds. Le rating n'est qu'un ingrédient — la façon dont il est consommé par le pricing (single-game vs series, blending avec autres signaux, calibration) compte autant que la qualité brute.

V1 heuristique blendé reste en prod. Phase 3 = calibration post-hoc + ensemble à explorer quand on a plus de data ou plus de temps.
