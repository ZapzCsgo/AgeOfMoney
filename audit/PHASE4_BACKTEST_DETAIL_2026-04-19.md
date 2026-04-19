# Phase 4 Glicko tier-weighted — diagnostic détaillé (2026-04-19)

N = 45 predictions valides (hors draws). Ratings rebuilt via `scripts/rebuild-ratings.ts`
avec TIER_WEIGHTS (S=4, Q=2.5, A=2, B=1, C=0.4, Showmatch/Misc=0.3). Les replays
internes du backtest utilisent aussi le tier-weighted Glicko.

## 1. Comparaison 3 configs

| Config | Brier | Log-loss | Accuracy |
|---|---|---|---|
| **A — V1 blended** (prod actuel) | 0.2104 | 0.6113 | 73.3% |
| **B — V2 blended** (Glicko dans le blend) | 0.3121 | 0.8751 | 53.3% |
| **C — V2 pur** (Glicko seul + binomiale) | 0.3694 | 1.0812 | 51.1% |

**Meilleur Brier** : A (V1)

### Verdict config C vs B
🔴 **C > B** de 0.0573 → Glicko a besoin du blending, il manque quelque chose seul.

### Verdict config C vs A (V1 prod)
🔴 **C pire que V1** de 0.1591 — Glicko pur n'est pas prêt.

## 2. Calibration comparée (buckets 10%)

| Bucket | V1 pred | V1 act | V2 pred | V2 act | V2pur pred | V2pur act | n_V1 |
|---|---|---|---|---|---|---|---|
|  0-10% | 0% | 0% | 8% | 100% | 8% | 73% | 0 |
| 10-20% | 0% | 0% | 18% | 50% | 16% | 67% | 0 |
| 20-30% | 0% | 0% | 24% | 80% | 25% | 100% | 0 |
| 30-40% | 36% | 67% | 34% | 83% | 38% | 50% | 3 |
| 40-50% | 45% | 44% | 43% | 50% | 44% | 100% | 9 |
| 50-60% | 55% | 80% | 52% | 100% | 50% | 75% | 20 |
| 60-70% | 65% | 82% | 66% | 100% | 65% | 100% | 11 |
| 70-80% | 73% | 100% | 72% | 50% | 74% | 50% | 2 |
| 80-90% | 0% | 0% | 82% | 75% | 85% | 67% | 0 |
| 90-100% | 0% | 0% | 92% | 67% | 92% | 71% | 0 |

## 3. Top 10 pires erreurs V2 (diagnostic qualitatif)

### #1 — Ciskhan vs Prisma09 (BO5, tier S)

- **Date** : 2026-04-17 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket C
- **Ratings Glicko** :
  - Ciskhan : 1794 ± 165
  - Prisma09 : 1165 ± 209
- **Prédictions** :
  - V1 : prob 47.6% (odds 1.93)
  - V2 blended : prob 92.0% (odds 1.05) ← erreur 92.0%
  - V2 pur : prob 92.0% (odds 1.05)
  - Glicko single-game : 94.1%
- **Résultat réel** : Prisma09 a gagné (score 0)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de Ciskhan** :
  - 2026-03-19 · tier B · L 0-4 vs Kingstone
  - 2026-04-08 · tier Qualifier · W 3-0 vs Scotty
  - 2026-04-11 · tier B · W 3-2 vs JorDan AoE
  - 2026-04-11 · tier B · L 0-3 vs Liereyy
  - 2026-04-16 · tier B · W 3-0 vs Lighty
- **5 derniers matchs de Prisma09** :
  - 2026-03-08 · tier B · W 1-0 vs Caguamas
  - 2026-03-09 · tier B · W 3-0 vs Gali
  - 2026-03-13 · tier B · L 1-2 vs Monoz
  - 2026-04-08 · tier B · L 2-3 vs Gali
  - 2026-04-11 · tier B · L 2-3 vs Sitaux

### #2 — VortiX vs Scatterbrained (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group B
- **Ratings Glicko** :
  - VortiX : 1165 ± 209
  - Scatterbrained : 1790 ± 155
- **Prédictions** :
  - V1 : prob 56.9% (odds 1.61)
  - V2 blended : prob 8.0% (odds 11.47) ← erreur 92.0%
  - V2 pur : prob 8.0% (odds 11.47)
  - Glicko single-game : 5.9%
- **Résultat réel** : VortiX a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de VortiX** :
  - 2026-03-17 · tier C · W 2-0 vs Jabalí
  - 2026-03-21 · tier C · W 2-0 vs Franncow
  - 2026-03-22 · tier C · W 3-2 vs LucifroN7
  - 2026-03-29 · tier C · W 1-0 vs LucifroN7
  - 2026-04-05 · tier S · L 1-3 vs Wam01
- **5 derniers matchs de Scatterbrained** :
  - 2026-04-11 · tier B · W 2-0 vs Antoxa
  - 2026-04-11 · tier B · W 2-1 vs Starflark
  - 2026-04-11 · tier B · L 2-3 vs Myriad
  - 2026-04-12 · tier B · W 2-1 vs Antoxa
  - 2026-04-12 · tier B · W 3-1 vs Muhodo

### #3 — 1puppypaw vs Valdemar (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group D
- **Ratings Glicko** :
  - 1puppypaw : 1165 ± 209
  - Valdemar : 1713 ± 178
- **Prédictions** :
  - V1 : prob 58.0% (odds 1.58)
  - V2 blended : prob 8.0% (odds 11.47) ← erreur 92.0%
  - V2 pur : prob 8.0% (odds 11.47)
  - Glicko single-game : 8.5%
- **Résultat réel** : 1puppypaw a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de 1puppypaw** :
  - 2026-03-21 · tier Qualifier · W 3-0 vs DeMu
  - 2026-03-21 · tier Qualifier · W 3-0 vs Valdemar
  - 2026-03-22 · tier Qualifier · W 4-0 vs Msn.dk
  - 2026-03-22 · tier Qualifier · L 1-4 vs Wam01
  - 2026-04-04 · tier S · L 1-3 vs MarineLorD
- **5 derniers matchs de Valdemar** :
  - 2026-04-11 · tier Qualifier · L 0-3 vs Corvinus1
  - 2026-04-11 · tier Qualifier · W 2-0 vs hiyoko
  - 2026-04-11 · tier B · L 3-0 vs Corvinus1
  - 2026-04-12 · tier B · W 2-0 vs HOMS-.-SENPAI
  - 2026-04-12 · tier B · W 3-0 vs Gento

### #4 — Lewis vs KingstoNe (BO5, tier S)

- **Date** : 2026-04-18 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket A
- **Ratings Glicko** :
  - Lewis : 2044 ± 134
  - KingstoNe : 1603 ± 163
- **Prédictions** :
  - V1 : prob 63.9% (odds 1.44)
  - V2 blended : prob 92.0% (odds 1.05) ← erreur 92.0%
  - V2 pur : prob 92.0% (odds 1.05)
  - Glicko single-game : 89.2%
- **Résultat réel** : KingstoNe a gagné (score 0)
- **H2H count** : 3 matchs entre eux avant cette date
- **5 derniers matchs de Lewis** :
  - 2026-04-10 · tier Qualifier · W 3-0 vs ZARC
  - 2026-04-11 · tier B · W 3-0 vs LobodeLaNieve
  - 2026-04-11 · tier B · W 3-2 vs Dogao
  - 2026-04-12 · tier B · L 3-4 vs FreakinAndy
  - 2026-04-16 · tier B · W 3-0 vs Alive
- **5 derniers matchs de KingstoNe** :
  - 2026-03-25 · tier Misc · L 1-4 vs Vinchester
  - 2026-03-28 · tier B · L 2-4 vs Dragonstar
  - 2026-04-10 · tier Qualifier · W 3-0 vs zankoku sekai no akuma
  - 2026-04-11 · tier B · L 3-1 vs Dogao
  - 2026-04-17 · tier B · W 3-0 vs DuDuZhu

### #5 — MarineLorD vs LucifroN (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group B
- **Ratings Glicko** :
  - MarineLorD : 1955 ± 168
  - LucifroN : 2321 ± 213
- **Prédictions** :
  - V1 : prob 66.0% (odds 1.39)
  - V2 blended : prob 14.9% (odds 6.16) ← erreur 85.1%
  - V2 pur : prob 8.0% (odds 11.47)
  - Glicko single-game : 16.8%
- **Résultat réel** : MarineLorD a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de MarineLorD** :
  - 2026-03-13 · tier Qualifier · W 3-0 vs AyameSatou
  - 2026-03-15 · tier Qualifier · W 4-0 vs Numudan
  - 2026-04-04 · tier S · W 3-1 vs 1puppypaw
  - 2026-04-06 · tier S · W 3-2 vs Wam01
  - 2026-04-18 · tier B · W 3-0 vs JIF Music
- **5 derniers matchs de LucifroN** :
  - 2026-03-29 · tier C · L 0-1 vs VortiX
  - 2026-04-11 · tier Qualifier · W 3-1 vs JIF Music
  - 2026-04-11 · tier Qualifier · W 2-0 vs Talouc
  - 2026-04-11 · tier B · W 3-1 vs JIF Music
  - 2026-04-18 · tier B · W 3-1 vs Numudan

### #6 — Classicpro vs JorDan AoE (BO5, tier S)

- **Date** : 2026-04-17 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket B
- **Ratings Glicko** :
  - Classicpro : 1962 ± 163
  - JorDan AoE : 1165 ± 209
- **Prédictions** :
  - V1 : prob 44.5% (odds 2.06)
  - V2 blended : prob 80.0% (odds 1.15) ← erreur 80.0%
  - V2 pur : prob 92.0% (odds 1.05)
  - Glicko single-game : 97.1%
- **Résultat réel** : JorDan AoE a gagné (score 0)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de Classicpro** :
  - 1970-01-01 · tier B · L  vs __claude_cache__
  - 2026-04-10 · tier B · L 3-0 vs ShiXo.
  - 2026-04-11 · tier B · W 3-0 vs Mihai06
  - 2026-04-11 · tier B · W 0-3 vs ACCM
  - 2026-04-14 · tier B · W 4-0 vs Sziky
- **5 derniers matchs de JorDan AoE** :
  - 2026-02-27 · tier A · W 3-0 vs Ganji
  - 2026-03-11 · tier Qualifier · W 3-0 vs Flying Mouse
  - 2026-03-25 · tier Misc · W 4-1 vs DauT
  - 2026-04-08 · tier Qualifier · W 3-1 vs Gali
  - 2026-04-11 · tier B · L 2-3 vs Ciskhan

### #7 — Barles vs JorDan AoE (BO5, tier S)

- **Date** : 2026-04-18 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket B
- **Ratings Glicko** :
  - Barles : 1531 ± 174
  - JorDan AoE : 1980 ± 201
- **Prédictions** :
  - V1 : prob 33.4% (odds 2.74)
  - V2 blended : prob 20.0% (odds 4.59) ← erreur 80.0%
  - V2 pur : prob 8.0% (odds 11.47)
  - Glicko single-game : 12.2%
- **Résultat réel** : Barles a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de Barles** :
  - 1970-01-01 · tier B · L  vs __claude_cache__
  - 2026-04-11 · tier B · L 3-2 vs StonePleaseAoE
  - 2026-04-16 · tier B · W 3-0 vs WaRRioR
- **5 derniers matchs de JorDan AoE** :
  - 2026-03-11 · tier Qualifier · W 3-0 vs Flying Mouse
  - 2026-03-25 · tier Misc · W 4-1 vs DauT
  - 2026-04-08 · tier Qualifier · W 3-1 vs Gali
  - 2026-04-11 · tier B · L 2-3 vs Ciskhan
  - 2026-04-17 · tier B · W 0-3 vs Classicpro

### #8 — DauT vs Sora Kuma (BO5, tier S)

- **Date** : 2026-04-18 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket B
- **Ratings Glicko** :
  - DauT : 1955 ± 103
  - Sora Kuma : 1165 ± 209
- **Prédictions** :
  - V1 : prob 44.6% (odds 2.06)
  - V2 blended : prob 80.0% (odds 1.15) ← erreur 80.0%
  - V2 pur : prob 92.0% (odds 1.05)
  - Glicko single-game : 97.5%
- **Résultat réel** : Sora Kuma a gagné (score 0)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de DauT** :
  - 2023-10-15 · tier B · L 0-3 vs Hera
  - 2026-04-11 · tier B · W 3-1 vs Villese
  - 2026-04-11 · tier B · W 2-3 vs StonePleaseAoE
  - 2026-04-12 · tier B · L 1-4 vs TheViper
  - 2026-04-17 · tier B · W 3-1 vs LobodeLaNieve
- **5 derniers matchs de Sora Kuma** :
  - 2026-02-12 · tier A · W 3-0 vs F1Re
  - 2026-02-14 · tier A · W 3-0 vs z40
  - 2026-02-24 · tier A · L 1-2 vs DauT
  - 2026-02-28 · tier A · W 4-0 vs wide
  - 2026-04-11 · tier B · L 3-1 vs Vivi

### #9 — VortiX vs Bee (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group B
- **Ratings Glicko** :
  - VortiX : 1564 ± 200
  - Bee : 1931 ± 253
- **Prédictions** :
  - V1 : prob 54.4% (odds 1.69)
  - V2 blended : prob 21.7% (odds 4.23) ← erreur 78.3%
  - V2 pur : prob 8.0% (odds 11.47)
  - Glicko single-game : 18.6%
- **Résultat réel** : VortiX a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de VortiX** :
  - 2026-03-21 · tier C · W 2-0 vs Franncow
  - 2026-03-22 · tier C · W 3-2 vs LucifroN7
  - 2026-03-29 · tier C · W 1-0 vs LucifroN7
  - 2026-04-05 · tier S · L 1-3 vs Wam01
  - 2026-04-18 · tier B · W 3-0 vs Scatterbrained
- **5 derniers matchs de Bee** :
  - 2023-11-21 · tier C · L 7-18 vs Wrongo Enj
  - 2023-12-02 · tier S · L 2-3 vs DeMu
  - 2023-12-09 · tier S · W 3-0 vs VortiX
  - 2023-12-10 · tier S · L 0-3 vs Beastyqt
  - 2026-04-18 · tier B · W 3-0 vs Corvinus1

### #10 — KingstoNe vs DuDuZhu (BO5, tier S)

- **Date** : 2026-04-17 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket A
- **Ratings Glicko** :
  - KingstoNe : 1165 ± 209
  - DuDuZhu : 1469 ± 174
- **Prédictions** :
  - V1 : prob 57.9% (odds 1.59)
  - V2 blended : prob 23.0% (odds 3.99) ← erreur 77.0%
  - V2 pur : prob 8.0% (odds 11.47)
  - Glicko single-game : 21.0%
- **Résultat réel** : KingstoNe a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de KingstoNe** :
  - 2026-03-19 · tier B · W 4-0 vs Ciskhan
  - 2026-03-25 · tier Misc · L 1-4 vs Vinchester
  - 2026-03-28 · tier B · L 2-4 vs Dragonstar
  - 2026-04-10 · tier Qualifier · W 3-0 vs zankoku sekai no akuma
  - 2026-04-11 · tier B · L 3-1 vs Dogao
- **5 derniers matchs de DuDuZhu** :
  - 2026-02-16 · tier B · L 0-3 vs Rodrixs
  - 2026-02-18 · tier B · W 2-1 vs Chanchilaru
  - 2026-02-24 · tier A · L 1-2 vs classicpro
  - 2026-04-09 · tier Qualifier · W 3-2 vs Uzzi
  - 2026-04-11 · tier B · L 0-3 vs Vinchester

## 4. Catégorisation des 10 pires erreurs

Heuristiques automatiques (à raffiner manuellement dans la discussion) :

- Ciskhan vs Prisma09 : **b) rating faux** (high RD, donnée insuffisante)
- VortiX vs Scatterbrained : **b) rating faux** (high RD, donnée insuffisante)
- 1puppypaw vs Valdemar : **b) rating faux** (high RD, donnée insuffisante)
- Lewis vs KingstoNe : **b) rating faux** (high RD, donnée insuffisante)
- MarineLorD vs LucifroN : **b) rating faux** (high RD, donnée insuffisante)
- Classicpro vs JorDan AoE : **b) rating faux** (high RD, donnée insuffisante)
- Barles vs JorDan AoE : **b) rating faux** (high RD, donnée insuffisante)
- DauT vs Sora Kuma : **b) rating faux** (high RD, donnée insuffisante)
- VortiX vs Bee : **b) rating faux** (high RD, donnée insuffisante)
- KingstoNe vs DuDuZhu : **b) rating faux** (high RD, donnée insuffisante)

**Répartition** : a=0 (0%) · b=10 (100%) · c=0 (0%)

## 5. Recommandation

**Tier-weighted Glicko aggravé vs Phase 3 vanilla.** La catégorisation reste 100 % "rating faux" comme en Phase 3, mais **avec des magnitudes d'erreur plus grandes** — logique : si le rating est faux (données sparse, RD > 150), les tier weights amplifient les mauvais signaux au lieu de les corriger. Le dataset à N=45 est trop pauvre pour que la pondération aide.

**Flag `ODDS_ENGINE_V2_ENABLED` reste OFF.** Voir synthèse dans [PHASE4_BACKTEST_RESULTS_2026-04-19.md](PHASE4_BACKTEST_RESULTS_2026-04-19.md).

Brier final : V1=0.2104, V2 blended=0.3121, V2 pur=0.3694.