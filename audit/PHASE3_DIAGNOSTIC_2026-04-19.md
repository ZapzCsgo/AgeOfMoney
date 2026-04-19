# Phase 3 Glicko — diagnostic (2026-04-19)

N = 45 predictions valides (hors draws).

## 1. Comparaison 3 configs

| Config | Brier | Log-loss | Accuracy |
|---|---|---|---|
| **A — V1 blended** (prod actuel) | 0.2104 | 0.6113 | 73.3% |
| **B — V2 blended** (Glicko dans le blend) | 0.2745 | 0.7520 | 55.6% |
| **C — V2 pur** (Glicko seul + binomiale) | 0.3213 | 0.8980 | 46.7% |

**Meilleur Brier** : A (V1)

### Verdict config C vs B
🔴 **C > B** de 0.0468 → Glicko a besoin du blending, il manque quelque chose seul.

### Verdict config C vs A (V1 prod)
🔴 **C pire que V1** de 0.1109 — Glicko pur n'est pas prêt.

## 2. Calibration comparée (buckets 10%)

| Bucket | V1 pred | V1 act | V2 pred | V2 act | V2pur pred | V2pur act | n_V1 |
|---|---|---|---|---|---|---|---|
|  0-10% | 0% | 0% | 0% | 0% | 8% | 100% | 0 |
| 10-20% | 0% | 0% | 15% | 100% | 14% | 100% | 0 |
| 20-30% | 0% | 0% | 25% | 100% | 26% | 57% | 0 |
| 30-40% | 36% | 67% | 36% | 73% | 34% | 88% | 3 |
| 40-50% | 45% | 44% | 44% | 57% | 46% | 100% | 9 |
| 50-60% | 55% | 80% | 56% | 88% | 52% | 67% | 20 |
| 60-70% | 65% | 82% | 65% | 86% | 66% | 33% | 11 |
| 70-80% | 73% | 100% | 74% | 50% | 74% | 100% | 2 |
| 80-90% | 0% | 0% | 82% | 67% | 88% | 50% | 0 |
| 90-100% | 0% | 0% | 0% | 0% | 92% | 60% | 0 |

## 3. Top 10 pires erreurs V2 (diagnostic qualitatif)

### #1 — VortiX vs Scatterbrained (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group B
- **Ratings Glicko** :
  - VortiX : 1338 ± 290
  - Scatterbrained : 1733 ± 195
- **Prédictions** :
  - V1 : prob 56.9% (odds 1.61)
  - V2 blended : prob 15.2% (odds 6.05) ← erreur 84.8%
  - V2 pur : prob 8.0% (odds 11.47)
  - Glicko single-game : 17.9%
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

### #2 — Lewis vs KingstoNe (BO5, tier S)

- **Date** : 2026-04-18 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket A
- **Ratings Glicko** :
  - Lewis : 1777 ± 201
  - KingstoNe : 1522 ± 248
- **Prédictions** :
  - V1 : prob 63.9% (odds 1.44)
  - V2 blended : prob 80.2% (odds 1.14) ← erreur 80.2%
  - V2 pur : prob 88.2% (odds 1.05)
  - Glicko single-game : 73.7%
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

### #3 — DauT vs Sora Kuma (BO5, tier S)

- **Date** : 2026-04-18 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket B
- **Ratings Glicko** :
  - DauT : 1788 ± 181
  - Sora Kuma : 1338 ± 290
- **Prédictions** :
  - V1 : prob 44.6% (odds 2.06)
  - V2 blended : prob 80.0% (odds 1.15) ← erreur 80.0%
  - V2 pur : prob 92.0% (odds 1.05)
  - Glicko single-game : 85.3%
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

### #4 — Ciskhan vs Prisma09 (BO5, tier S)

- **Date** : 2026-04-17 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket C
- **Ratings Glicko** :
  - Ciskhan : 1612 ± 224
  - Prisma09 : 1338 ± 290
- **Prédictions** :
  - V1 : prob 47.6% (odds 1.93)
  - V2 blended : prob 75.6% (odds 1.21) ← erreur 75.6%
  - V2 pur : prob 88.2% (odds 1.05)
  - Glicko single-game : 73.7%
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

### #5 — 1puppypaw vs Valdemar (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group D
- **Ratings Glicko** :
  - 1puppypaw : 1338 ± 290
  - Valdemar : 1630 ± 223
- **Prédictions** :
  - V1 : prob 58.0% (odds 1.58)
  - V2 blended : prob 24.7% (odds 3.72) ← erreur 75.3%
  - V2 pur : prob 10.3% (odds 8.88)
  - Glicko single-game : 25.0%
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

### #6 — Classicpro vs JorDan AoE (BO5, tier S)

- **Date** : 2026-04-17 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket B
- **Ratings Glicko** :
  - Classicpro : 1699 ± 217
  - JorDan AoE : 1338 ± 290
- **Prédictions** :
  - V1 : prob 44.5% (odds 2.06)
  - V2 blended : prob 74.9% (odds 1.23) ← erreur 74.9%
  - V2 pur : prob 92.0% (odds 1.05)
  - Glicko single-game : 79.7%
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
  - Barles : 1503 ± 256
  - JorDan AoE : 1610 ± 260
- **Prédictions** :
  - V1 : prob 33.4% (odds 2.74)
  - V2 blended : prob 31.2% (odds 2.94) ← erreur 68.8%
  - V2 pur : prob 31.8% (odds 2.88)
  - Glicko single-game : 40.0%
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

### #8 — Hearttt vs Dark (BO5, tier S)

- **Date** : 2026-04-18 · **Tournoi** : Brazilian Dynasty: International Qualifier 2 - Bracket A
- **Ratings Glicko** :
  - Hearttt : 1720 ± 260
  - Dark : 1622 ± 226
- **Prédictions** :
  - V1 : prob 60.6% (odds 1.51)
  - V2 blended : prob 65.7% (odds 1.4) ← erreur 65.7%
  - V2 pur : prob 67.2% (odds 1.36)
  - Glicko single-game : 59.4%
- **Résultat réel** : Dark a gagné (score 0)
- **H2H count** : 2 matchs entre eux avant cette date
- **5 derniers matchs de Hearttt** :
  - 2026-04-02 · tier S · W 3-2 vs Yo
  - 2026-04-03 · tier S · W 3-0 vs MbL
  - 2026-04-04 · tier S · L 3-4 vs Sebastian
  - 2026-04-16 · tier B · W 3-0 vs Chanchilaru
  - 2026-04-17 · tier B · W 3-0 vs Chanchilaru
- **5 derniers matchs de Dark** :
  - 2026-03-29 · tier C · W 1-0 vs The_Beatleman
  - 2026-03-29 · tier C · L 0-1 vs AntagonisT
  - 2026-04-09 · tier Qualifier · W 3-0 vs Sziky
  - 2026-04-11 · tier B · W 1-3 vs Lucho
  - 2026-04-11 · tier B · L 1-3 vs FreakinAndy

### #9 — Beastyqt vs Myriad (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group B
- **Ratings Glicko** :
  - Beastyqt : 1732 ± 287
  - Myriad : 1809 ± 294
- **Prédictions** :
  - V1 : prob 42.0% (odds 2.19)
  - V2 blended : prob 35.7% (odds 2.57) ← erreur 64.3%
  - V2 pur : prob 37.5% (odds 2.44)
  - Glicko single-game : 43.3%
- **Résultat réel** : Beastyqt a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de Beastyqt** :
  - 1970-01-01 · tier B · L  vs __claude_cache__
  - 2026-04-11 · tier B · W 3-0 vs Muhodo
- **5 derniers matchs de Myriad** :
  - 2026-03-28 · tier B · W 3-0 vs MrEggoWaffles
  - 2026-03-29 · tier B · W 3-0 vs Nasu
  - 2026-03-31 · tier B · L 2-3 vs Numudan
  - 2026-04-11 · tier Qualifier · W 2-0 vs The true bretonnian
  - 2026-04-11 · tier B · W 3-2 vs Scatterbrained

### #10 — Bee vs Corvinus1 (BO5, tier A)

- **Date** : 2026-04-18 · **Tournoi** : Epohers World Cup 2 - Group B
- **Ratings Glicko** :
  - Bee : 1500 ± 350
  - Corvinus1 : 1662 ± 290
- **Prédictions** :
  - V1 : prob 54.7% (odds 1.68)
  - V2 blended : prob 36.7% (odds 2.5) ← erreur 63.3%
  - V2 pur : prob 26.7% (odds 3.44)
  - Glicko single-game : 37.0%
- **Résultat réel** : Bee a gagné (score 1)
- **H2H count** : 0 matchs entre eux avant cette date
- **5 derniers matchs de Bee** :
  - 2023-11-19 · tier B · W 2-0 vs Deniskya
  - 2023-11-21 · tier C · L 7-18 vs Wrongo Enj
  - 2023-12-02 · tier S · L 2-3 vs DeMu
  - 2023-12-09 · tier S · W 3-0 vs VortiX
  - 2023-12-10 · tier S · L 0-3 vs Beastyqt
- **5 derniers matchs de Corvinus1** :
  - 2026-03-20 · tier Qualifier · L 1-3 vs Valdemar
  - 2026-03-20 · tier Qualifier · W 3-1 vs Chrysaor
  - 2026-04-11 · tier Qualifier · W 3-0 vs Valdemar
  - 2026-04-11 · tier Qualifier · W 2-0 vs marcotamby
  - 2026-04-11 · tier B · W 0-3 vs Valdemar

## 4. Catégorisation des 10 pires erreurs

Heuristiques automatiques (à raffiner manuellement dans la discussion) :

- VortiX vs Scatterbrained : **b) rating faux** (high RD, donnée insuffisante)
- Lewis vs KingstoNe : **b) rating faux** (high RD, donnée insuffisante)
- DauT vs Sora Kuma : **b) rating faux** (high RD, donnée insuffisante)
- Ciskhan vs Prisma09 : **b) rating faux** (high RD, donnée insuffisante)
- 1puppypaw vs Valdemar : **b) rating faux** (high RD, donnée insuffisante)
- Classicpro vs JorDan AoE : **b) rating faux** (high RD, donnée insuffisante)
- Barles vs JorDan AoE : **b) rating faux** (high RD, donnée insuffisante)
- Hearttt vs Dark : **b) rating faux** (high RD, donnée insuffisante)
- Beastyqt vs Myriad : **b) rating faux** (high RD, donnée insuffisante)
- Bee vs Corvinus1 : **b) rating faux** (high RD, donnée insuffisante)

**Répartition** : a=0 (0%) · b=10 (100%) · c=0 (0%)

## 5. Recommandation

**Glicko ne vaut pas le coup sur ce dataset.** Ni blended ni pur ne battent V1. Move on jusqu'à N=200+ matchs COMPLETED pour backtest plus robuste. Le code Glicko reste committed dormant, on peut y revenir.

Brier final : V1=0.2104, V2 blended=0.2745, V2 pur=0.3213.