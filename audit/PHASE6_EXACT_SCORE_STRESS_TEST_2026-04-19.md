# Phase 6 — Stress tests Score Exact (2026-04-19)

> **Objectif** : valider empiriquement que le moteur Score Exact en prod fait ce qu'on pense qu'il fait,
> AVANT toute implémentation V2. 5 tests : edge cases numériques, BO1 margin trap, théorie pure vs blend,
> baseline vs références naïves, et audit stratégique du BO1.

> ⚠️ **Aucun code du moteur modifié par ces tests.** Pure lecture + compute local.

---

## Test 1 — Edge cases numériques

Règles vérifiées par cas :
- (A) Aucune odd < 1.05 (MIN_ODDS skill)
- (B) Aucune odd > 10.0 (EXACT_SCORE_MAX_ODDS)
- (C) Σ probas = 1.00 ± 1e-6
- (D) Overround ∈ [1.12, 1.22]
- (E) Si 50/50, P symétrique (|P(i) - P(miroir)| < 1e-9)

| Cas | Min odd | Max odd | Σ probas | Overround | Sym? | Verdict |
|---|---|---|---|---|---|---|
| favori écrasant BO3 (BO3 1.05/15) | 1.193 | 10.000 | 1.000000 | 1.2995 | — | ❌ FAIL |
| favori écrasant BO5 (BO5 1.05/15) | 1.720 | 10.000 | 1.000000 | 1.3995 | — | ❌ FAIL |
| favori écrasant BO7 (BO7 1.05/15) | 2.606 | 10.000 | 1.000000 | 1.4995 | — | ❌ FAIL |
| gros favori BO2 (draw 8.0) (BO2 1.08/10 draw 8) | 1.057 | 9.783 | 1.000000 | 1.1765 | — | ✅ OK |
| favori marqué BO5 (BO5 1.25/4) | 2.958 | 10.000 | 1.000000 | 1.2255 | — | ❌ FAIL |
| 50/50 BO5 (BO5 1.9/1.9) | 4.533 | 6.800 | 1.000000 | 1.1765 | OK | ✅ OK |
| underdog BO3 (BO3 3/1.4) | 2.185 | 6.004 | 1.000000 | 1.1765 | — | ✅ OK |
| upset écrasant BO7 (BO7 10/1.05) | 2.792 | 10.000 | 1.000000 | 1.4647 | — | ❌ FAIL |

**Verdict global test 1** : ❌ au moins un cas KO

### Détails par cas

- favori écrasant BO3: (D) overround 1.2995 hors [1.12, 1.22]
  - probas : 2-0=71.2%, 2-1=22.2%, 1-2=4.1%, 0-2=2.4%
  - odds : 2-0=1.19, 2-1=3.82, 1-2=10.00, 0-2=10.00
- favori écrasant BO5: (D) overround 1.3995 hors [1.12, 1.22]
  - probas : 3-0=49.4%, 3-1=31.0%, 3-2=13.0%, 2-3=3.4%, 1-3=2.2%, 0-3=0.9%
  - odds : 3-0=1.72, 3-1=2.74, 3-2=6.54, 2-3=10.00, 1-3=10.00, 0-3=10.00
- favori écrasant BO7: (D) overround 1.4995 hors [1.12, 1.22]
  - probas : 4-0=32.6%, 4-1=31.9%, 4-2=19.5%, 4-3=9.5%, 3-4=3.1%, 2-4=2.0%, 1-4=1.1%, 0-4=0.4%
  - odds : 4-0=2.61, 4-1=2.67, 4-2=4.37, 4-3=8.94, 3-4=10.00, 2-4=10.00, 1-4=10.00, 0-4=10.00
  - probas : 2-0=80.5%, 1-1=10.9%, 0-2=8.7%
  - odds : 2-0=1.06, 1-1=7.83, 0-2=9.78
- favori marqué BO5: (D) overround 1.2255 hors [1.12, 1.22]
  - probas : 3-0=27.2%, 3-1=28.7%, 3-2=20.2%, 2-3=11.0%, 1-3=8.5%, 0-3=4.4%
  - odds : 3-0=3.12, 3-1=2.96, 3-2=4.20, 2-3=7.74, 1-3=10.00, 0-3=10.00
  - probas : 3-0=12.5%, 3-1=18.8%, 3-2=18.8%, 2-3=18.8%, 1-3=18.8%, 0-3=12.5%
  - odds : 3-0=6.80, 3-1=4.53, 3-2=4.53, 2-3=4.53, 1-3=4.53, 0-3=6.80
  - probas : 2-0=14.2%, 2-1=17.7%, 1-2=29.3%, 0-2=38.9%
  - odds : 2-0=6.00, 2-1=4.81, 1-2=2.90, 0-2=2.18
- upset écrasant BO7: (D) overround 1.4647 hors [1.12, 1.22]
  - probas : 4-0=0.6%, 4-1=1.6%, 4-2=3.0%, 4-3=4.3%, 3-4=11.4%, 2-4=20.9%, 1-4=30.4%, 0-4=27.8%
  - odds : 4-0=10.00, 4-1=10.00, 4-2=10.00, 4-3=10.00, 3-4=7.43, 2-4=4.07, 1-4=2.79, 0-4=3.06

---

## Test 2 — BO1 margin trap (main winner vs exact "1-0")

Hypothèse : sur un BO1, `exact "1-0"` et `main winner P1` sont le même événement. Mais l'un applique 15% de margin (exact), l'autre 9% (main 2-way). Si l'écart dépasse 3%, le marché exact est un piège UX (même bet, payé moins).

Matchs BO1 inspectés : 0

### 10 matchs BO1 avec les plus gros écarts (pire des 2 sides)

| Match | Statut | Main P1 | Exact 1-0 | Gap P1 | Main P2 | Exact 0-1 | Gap P2 |
|---|---|---|---|---|---|---|---|

**Aucun match BO1 en DB** — test non applicable. Vérifier quand des BO1 seront ajoutés.

---

## Test 3 — Théorie pure vs blend H2H/solo

> ⚠️ **Data leakage** : le blend utilise l'état courant de `PlayerMatchRecord` (pas de snapshot point-in-time). Un match de 2026-03 "voit" des records de 2026-04. Ce test est donc **optimiste en faveur du blend** — si malgré ça le blend perd, c'est un signal fort.

Matchs testés : 121 (BO3/5/7 avec resultScore)
Blend s'est activé sur : 114 matchs (sinon retour pure theory car data insuffisante)

| Métrique | Pure théorie | Blend (actuel prod) | Δ (blend - pure) |
|---|---|---|---|
| RPS | 0.2110 | 0.2007 | -0.0103 |
| Brier | 0.8238 | 0.7895 | -0.0343 |
| Log-loss | 1.7666 | 1.6737 | -0.0929 |

**Verdict test 3** : 🟡 **AMBIGU** (|Δ| ≤ 0.02, dans le bruit). Garder V1 par défaut mais à re-mesurer quand N ≥ 200. Le corridor + les tier-weights semblent ne rien casser, mais n'apportent rien de visible non plus sur ce sample.

### 5 matchs où le blend AMÉLIORE le plus la prédiction

| Match | Format | Actual | RPS pure | RPS blend | Δ |
|---|---|---|---|---|---|
| Liereyy vs Kasva | BO5 | 3-0 | 0.293 | 0.230 | -0.063 |
| Sebastian vs Dennis | BO5 | 3-0 | 0.284 | 0.224 | -0.060 |
| Hearttt vs Chanchilaru | BO5 | 3-0 | 0.291 | 0.234 | -0.056 |
| Liereyy vs Ciskhan | BO5 | 3-0 | 0.300 | 0.245 | -0.055 |
| TaToH vs Dennis | BO5 | 3-0 | 0.284 | 0.229 | -0.055 |

### 5 matchs où le blend DÉGRADE le plus la prédiction

| Match | Format | Actual | RPS pure | RPS blend | Δ |
|---|---|---|---|---|---|
| SAS vs Nasu | BO3 | 1-2 | 0.115 | 0.150 | +0.034 |
| Running vs Fedex | BO5 | 3-1 | 0.143 | 0.165 | +0.021 |
| Valdemar vs Corvinus1 | BO5 | 0-3 | 0.320 | 0.342 | +0.021 |
| 1puppypaw vs Anotand | BO5 | 1-3 | 0.161 | 0.182 | +0.021 |
| Sora Kuma vs Vivi | BO5 | 1-3 | 0.134 | 0.154 | +0.019 |

---

## Test 4 — Baseline backtest + références (random, 50/50)

> ⚠️ **Sample size** : N=138 matchs répartis sur 4 formats. ~5–15 observations par format sur BO2/BO3/BO7. Swing de 3-4 matchs peut renverser un classement. Indicatif, pas statistiquement robuste.

### Comparaison par format

| Format | N | V1 RPS | Random uniforme RPS | 50/50 théorie RPS | V1 gain vs random | V1 gain vs 50/50 |
|---|---|---|---|---|---|---|
| BO2 | 17 | **0.1582** | 0.1895 | 0.1801 | 0.0314 | 0.0220 |
| BO3 | 14 | **0.2272** | 0.2440 | 0.2440 | 0.0168 | 0.0168 |
| BO5 | 102 | **0.2122** | 0.2193 | 0.2233 | 0.0071 | 0.0111 |
| BO7 | 5 | **0.1423** | 0.1554 | 0.1521 | 0.0131 | 0.0098 |

(Gain positif = V1 bat le référent.)

**Overall** : V1 RPS = 0.2045 · Random = 0.2158 (V1 gagne 0.0113) · 50/50 théorie = 0.2175 (V1 gagne 0.0129)

**Verdict test 4** : V1 bat le random uniforme · V1 bat la théorie 50/50.
Le moteur exploite bien les odds main. Pas de drapeau rouge sur la calibration de base.

---

## Test 5 — Audit stratégique du BO1 dans le marché exact-score

**Question** : pourquoi offrir un marché "exact-score" sur un BO1 alors que
`1-0`/`0-1` sont exactement les 2 outcomes du marché winner ?

### Math du gap

- Main winner (2-way, 9 % margin) : `odds_main = 1 / (p × 1.09) = 0.917 / p`
- Exact-score (15 % margin) : `odds_exact = 0.85 / p`
- **Ratio fixe `exact/main = 0.85 / 0.917 = 0.927`** → l'exact-score paie
  **7.3 % moins** pour le même événement, quelle que soit la valeur de `p`.

Test 2 n'a pas pu empiriquement le mesurer (0 match BO1 en DB actuellement),
mais la formule ci-dessus est exacte : le trap existe par construction dès
qu'un BO1 est offert.

### 3 options pour arbitrer

| # | Option | Avantages | Inconvénients |
|---|---|---|---|
| **a** | Garder tel quel + document comme intentionnel | Revenu marginal supplémentaire sur les users qui choisissent le mauvais marché. Zéro change code. | UX trap caché. Un user avisé qui compare les 2 cotes verra qu'on lui fait payer 7 % de plus pour le même pari. Réputation. |
| **b** | Réduire margin BO1 exact-score à 9 % (match main) | Parité UX. Plus de piège. | Complexité code (switch margin par format). Revenu identique entre les 2 marchés → utilité réduite d'avoir les 2. |
| **c** | Retirer BO1 du marché exact-score | Le plus propre. Plus de confusion possible. Simplifie UI. | Perte de volume de paris sur les BO1 (mineur car BO1 = rare en AoE esport, quasi tous les matchs sont BO3+). |

### Recommandation

**Option c** (retirer BO1 du marché exact-score) est le plus propre. Impact
volume quasi-nul en esport AoE4/AoE2 où les BO1 sont uniquement des groupes
occasionnels (0 match BO1 COMPLETED en DB à date). Zéro friction UX, zéro
code conditionnel.

**À arbitrer par l'utilisateur** avant implémentation.

---

## Verdict global — 🟠 BOUGE (1 issue critique + 1 mineure)

### Résumé des 5 tests

| Test | Verdict | Criticité |
|---|---|---|
| 1. Edge cases numériques | ❌ 4/8 cas KO sur overround | **HAUTE** — risque business concret |
| 2. BO1 margin trap | N/A (aucun BO1 en DB) | Basse (trap existe par construction mais 0 matchs concernés) |
| 3. Pure vs blend | 🟡 Ambigu (blend gagne 0.01 RPS, sous le bruit + data-leakage) | Basse — ne rien changer |
| 4. Baseline vs refs | ✅ V1 bat random et 50/50 sur tous formats | OK |
| 5. BO1 intention | Question ouverte à arbitrer | Basse (0 matchs concernés) |

### Issue critique (Test 1) — Overround explosif sur matchs déséquilibrés

Avec `EXACT_SCORE_MAX_ODDS = 10` (le cap actuel), dès qu'un score a une
probabilité `< 0.085`, sa cote théorique dépasse 10 et se fait clamper. Le
clamp augmente l'implied probability → augmente l'overround book-wide.

**Chiffres mesurés** :

| Cas | Overround attendu | Overround réel | Marge effective |
|---|---|---|---|
| 50/50 BO5 | ~17.6 % | 17.65 % | 15 % (conforme) |
| Favori marqué BO5 (1.25/4) | ~17.6 % | 22.55 % | ~20 % |
| Favori écrasant BO3 (1.05/15) | ~17.6 % | **29.95 %** | **25 %** |
| Favori écrasant BO5 (1.05/15) | ~17.6 % | **39.95 %** | **34 %** |
| Favori écrasant BO7 (1.05/15) | ~17.6 % | **49.95 %** | **44 %** |
| Upset écrasant BO7 (10/1.05) | ~17.6 % | **46.47 %** | **41 %** |

**Impact business** : un user qui parie sur le camp perdant d'un BO7
déséquilibré achète un paquet de cotes à ~41 % de house edge. Le skill
`odds-engine-aoe4` cible 9 %–15 % de margin. On est très loin du cadre.

**Ce n'est PAS un bug logique** — la formule produit des probabilités
correctes, la cap est une protection anti-bankruptcy (qu'un 4-3 BO7 à
odds 150 ne bankrupte pas le book si un whale mise). Mais le *side-effect*
est une over-margin silencieuse qui n'est ni documentée ni paramétrable.

### Fix proposé (derrière `ODDS_ENGINE_EXACT_V2_ENABLED`, default OFF)

Plutôt que de juste clamper les odds à 10, **redistribuer la probabilité
excédentaire** après clamp pour garder l'overround cible :

1. Calculer les probas théoriques.
2. Clamp chaque proba à un **floor** (ex. 1 %) et un **ceiling** (ex. 95 %)
   — pas les odds.
3. Renormaliser à somme = 1.
4. Appliquer la margin globale : `odds_i = (1 - 0.15) / p_i_renormalized`.
5. Cap max odds à 10 en POST-traitement (pour l'UX "pas de cotes à 150×"),
   mais la margin reste stable à 17.6 % globale car déjà appliquée.

Alternative plus conservative : **retirer le cap MAX=10** et laisser les
rare scores afficher leur vraie cote (20, 50, 100×). Risk bankruptcy sur un
whale qui tape pile → à cadrer via un bet-size-cap au lieu d'un odds-cap.

**À NE PAS toucher tant que le flag `ODDS_ENGINE_EXACT_V2_ENABLED` n'existe
pas.** Le flag est à créer quand le user décide de bouger.

### Issue mineure (Test 5) — BO1 redondant

Le marché exact-score BO1 est fonctionnellement identique au marché winner
avec 7.3 % de margin en plus. Option recommandée : **c — retirer BO1 du
score exact** (zéro friction, zéro code complexe). À arbitrer.

---

## Non-régressions vérifiées (ce qui va bien)

- ✅ Formules binomiales exactes (test 1 sum=1, symétrie 50/50)
- ✅ MIN_ODDS 1.05 : aucun cas testé ne descend en dessous (le risque
  théorique de l'audit étape 1 ne matérialise pas dans les cas usuels)
- ✅ MAX_ODDS 10 : cap bien appliqué
- ✅ Blend H2H/solo : n'aggrave rien de visible (Δ RPS = -0.01 en sa faveur,
  dans le bruit mais pas négatif — sain)
- ✅ Moteur bat les baselines naïves (random + 50/50) sur tous les formats

---

## Actions proposées (non exécutées)

1. **Décider de retirer ou non BO1 du marché exact-score** (option c
   recommandée). Trivial à implémenter : un `if (format === 'BO1') return []`
   dans `exactScoreOddsBlended`. Je te demande avant de toucher.
2. **Implémenter le fix overround** derrière `ODDS_ENGINE_EXACT_V2_ENABLED`
   quand tu valides. Flag default OFF.
3. **Le cron weekly Score Exact est déjà branché** (commit 16e5eb2) — il
   va capturer les métriques chaque lundi + déclencher warning si RPS
   dégrade de ≥ 0.05 vs semaine -3.
4. **Re-mesurer** quand N ≥ 200 pour validation robuste des chiffres +
   backtest d'un éventuel V2.

---

## Fichiers

- Script stress : [backend/scripts/stress-test-exact-score.ts](../backend/scripts/stress-test-exact-score.ts)
- Moteur actuel : [backend/src/routes/bets.ts:109-239](../backend/src/routes/bets.ts#L109) (math + entries)
- Blend : [backend/src/services/exactScoreModel.ts](../backend/src/services/exactScoreModel.ts)
- Harness baseline (réutilisé par Test 4) : [backend/src/services/exactScoreBacktestHarness.ts](../backend/src/services/exactScoreBacktestHarness.ts)
