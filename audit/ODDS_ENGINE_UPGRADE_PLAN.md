# Odds Engine — Plan d'upgrade (2026-04-19)

> **Objectif** : passer du blending heuristique actuel à un moteur calibré
> niveau sharp book (Pinnacle / Betfair exchange) sans casser les règles métier
> (cf. `.claude/skills/odds-engine-aoe4/SKILL.md`).

## Cibles mesurables

| KPI | Cible | Cible stretch |
|---|---|---|
| Brier score (200 derniers matchs) | **< 0.20** | < 0.16 |
| Log-loss | < 0.55 | < 0.48 |
| Calibration : écart max predicted vs actual | **< 10%** par bucket | < 5% |
| Top-choice accuracy | > 70% | > 75% |
| Book ROI simulé (500 matchs) | **≥ 5% du handle** | ≥ 8% |
| Overround par match | **∈ [1.05, 1.12]** toujours | [1.07, 1.10] |
| % matchs avec odd < 1.10 ou > 15 | **< 10%** | < 5% |

## Baseline (étape 1 — voir `BASELINE_ODDS_ENGINE_<date>.md`)

Avant upgrade : mesurer l'état actuel sur les N derniers matchs COMPLETED
via `scripts/backtest-baseline.ts`. Résultats à comparer après chaque phase.

---

## Tableau des features candidates (priorité décroissante)

| # | Feature | Effort | Impact Brier | Dépendances | Risque régression | Phase |
|---|---|---|---|---|---|---|
| 1 | **Time decay exponentiel sur le form + WR** (λ ~90j) | **S** | **-0.02** | Aucune | Faible | 1 |
| 2 | **Glicko-2 rating par joueur** (remplace WR brut) | L | -0.04 | Nouvelle table `PlayerRating` | Moyen | 2 |
| 3 | **Bradley-Terry avec prior bayésien** (remplace blending linéaire) | **L** | **-0.03** | Ratings Glicko | Moyen | 2 |
| 4 | **Ensemble** = moy pondérée (BT + Glicko + raw-blend) | **M** | **-0.01** | Les 3 sous-modèles | Faible | 2-3 |
| 5 | **Calibration post-hoc** (Platt scaling ou isotonic) | M | -0.02 | 500+ matchs historiques | Faible | 3 |
| 6 | **Opponent pool quality** (variance de la force des adversaires battus) | **S** | -0.015 | Aucune (DB) | Faible | 1 |
| 7 | **Momentum detector** (streaks ≥ 3 consécutifs : bonus/malus) | **XS** | -0.008 | Aucune | Très faible | 1 |
| 8 | **Tournament context** (round importance, prize pool) | M | -0.01 | Parse tournament format depuis Liquipedia | Moyen | 3 |
| 9 | **Rest factor non-linéaire** (fatigue 24h / rust >14j / perf window) | XS | -0.005 | Aucune | Très faible | 1 |
| 10 | **Map-pool / civilisation WR** (AoE4 seulement) | L | -0.02 | Pas stocké en DB — scrape requis | Élevé | 4 |
| 11 | **Market microstructure** (margin adaptative par tier) | S | 0 (neutre Brier) | Aucune | Faible | 3 |
| 12 | **Risk management** (exposure caps, sharp detection) | L | 0 (pas un facteur de pricing) | Nouveau middleware | Moyen | 4 |

> Impact Brier cumulatif attendu : baseline ~0.22 → **~0.14** après les 11 features.

---

## Roadmap 4 phases

### 🔧 Phase 1 — Quick wins (cette semaine)
**Objectif** : Brier ↓ 0.03, zéro refonte.

- ✅ **1.1** Backtest baseline (`scripts/backtest-baseline.ts`) — livré
- **1.2** Ajouter `TIME_DECAY_LAMBDA` au WR Bayesian (λ = 90 jours, actuel = 180). Les matchs de 2024 pèsent trop.
- **1.3** Opponent pool quality : au lieu du simple mul opp-strength 0.4-1.6, calculer un "SOS" (Strength of Schedule) agrégé par joueur : joueur qui affronte du 80% WR en moyenne a un boost de +0.1 logit.
- **1.4** Momentum detector : streak ≥ 3 wins consécutifs contre top-50 ajoute +0.05 logit par match (capé à +0.25). Streak ≥ 3 losses retire inverse.
- **1.5** Rest factor non-linéaire : 0-24h = -0.03 (fatigue), 1-7j = 0 (optimal), 7-30j = 0 (normal), >30j = -0.05 (rust). Remplace la pénalité linéaire actuelle.
- **1.6** Feature flag `ODDS_ENGINE_V2_ENABLED` via env Railway — gate toutes les nouvelles features derrière, default false. Activation manuelle après validation backtest.

### 🏗️ Phase 2 — Refonte scientifique (semaines 2-3)
**Objectif** : Brier ↓ 0.04 supplémentaire, modèle calibré mathématiquement.

- **2.1** Table `PlayerRating` : `{ playerId, game, rating, deviation, volatility, lastUpdatedAt, ratingByTier: JSON }`. Prisma migration.
- **2.2** Service `ratingEngine.ts` : Glicko-2 update après chaque match terminé. Rebuild full sur les données historiques (chronologique, one-shot).
- **2.3** Function `bradleyTerryWinProb(r1, r2, var1, var2)` — calcule P(p1 wins) via `1 / (1 + exp(-(r1-r2) / sqrt(var1 + var2)))` avec prior bayésien.
- **2.4** `calculateOddsV2` réécrite pour consommer les ratings au lieu du WR brut. Le blending reste (H2H, form, tier-context) mais le facteur "WR global" devient "rating-based prob".
- **2.5** Ensemble : sortie finale = 0.5 × BT + 0.3 × raw-blend (actuel) + 0.2 × ELO simple. Pondération à calibrer par LOOCV.

### 📐 Phase 3 — Calibration + backtest automatique (mois 2)
**Objectif** : modèle CALIBRÉ (predicted ≈ actual par bucket), auto-validé.

- **3.1** Post-hoc calibration via **Platt scaling** : `p_calibrated = sigmoid(a × logit(p) + b)`, avec `a, b` fittés sur les 500 derniers matchs.
- **3.2** Alternative isotonic regression si Platt sous-performe (rare, mais possible sur distributions bimodales).
- **3.3** Cron mensuel : re-fit des paramètres (a, b) avec les données les plus récentes. Stockés dans une table `OddsCalibration` avec versioning.
- **3.4** Script `backtest-harness.ts` qui tourne automatiquement après chaque push sur master (ou weekly), compare Brier/ROI vs snapshot précédent, fail si régression > 5%.
- **3.5** Market microstructure : margin adaptative par liquidity — S-tier tournament = 6% overround (tight), C-tier/Misc = 11% (plus de buffer).

### 🛡️ Phase 4 — Risk management + optimisations prod (mois 3)
**Objectif** : protéger le book des edge cases, max revenue sans risque bust.

- **4.1** `exposureTracker.ts` : tracking temps réel du liability par match et par outcome. Limite max 5000 coins par outcome sans approbation admin.
- **4.2** Sharp money detector : si un même user bet > 1000 coins en 5 min sur un outcome, freeze ce côté pendant 30 secondes, réévaluer modèle.
- **4.3** Automatic market suspend si écart `model_prob vs market_implied` > 5% — signal qu'une news est arrivée (forfait, line-up change).
- **4.4** Shadow book mode : en parallèle du modèle live, faire tourner un modèle "expérimental" en shadow pour A/B comparer sur 2 semaines sans exposer les users.
- **4.5** Map-pool civ WR AoE4 : scrape Liquipedia pour civ pref par joueur, augmenter la prob si le pool map favorise leur civ spé.

---

## Plan de validation (après chaque phase)

| Phase | Brier cible | ROI cible | Calibration max écart |
|---|---|---|---|
| Baseline | ? (mesuré) | ? | ? |
| Phase 1 | ≤ baseline - 0.02 | ≥ baseline + 1% | inchangé |
| Phase 2 | ≤ 0.18 | ≥ 6% | < 15% |
| Phase 3 | ≤ 0.16 | ≥ 7% | **< 5%** (objectif critique) |
| Phase 4 | ≤ 0.14 | ≥ 8% | < 4% |

À chaque phase :
1. Rerun `scripts/backtest-baseline.ts` + compare vs phase précédente
2. Dry-run sur 20 matchs UPCOMING via `scripts/debug-compare-two-players.ts`
3. Vérifier overround dans [1.05, 1.12] et pas d'outlier odd < 1.05 / > 20
4. Si régression sur n'importe quel KPI → rollback feature flag

## Règles spécifiques (cf. skill `odds-engine-aoe4`)

- **Toute nouvelle feature modifiant le pricing** va derrière `ODDS_ENGINE_V2_ENABLED` (env var). Default `false`, activation manuelle post-validation.
- **MIN_ODDS ≥ 1.05 / MAX_ODDS ≤ 20 / margin ∈ [5%, 12%]** — bornes immuables.
- **Opponent-strength multiplier** reste obligatoire (plus ou moins intelligent selon la phase, mais jamais supprimé).
- **BO1/2/3/5/7 doivent tous passer** un smoke-test à chaque phase.
- **Règles de format BO2** (void-on-draw, 1-1 = refund, draws ne drag pas le form) — conservées.

## Références académiques

- **Glicko-2** : Mark E. Glickman (2012) — http://www.glicko.net/glicko/glicko2.pdf
- **TrueSkill 2** : Herbrich et al. (2007) — probabilistic ranking Microsoft
- **Bradley-Terry model** : Bradley & Terry (1952) — modèle de pairwise comparison
- **Bradley-Terry-Davidson** : Davidson (1970) — extension pour draws
- **Platt scaling** : Platt (1999) — calibration post-hoc SVM
- **Isotonic regression** : Zadrozny & Elkan (2002) — calibration non-paramétrique
- **Poisson regression (esport)** : Boshnakov et al. (2017) — pour scoring map-level

## Livrable à chaque phase

```
audit/ODDS_ENGINE_V2_PHASE_<N>_REPORT.md     — comparaison chiffrée vs baseline
audit/ODDS_ENGINE_V2_PHASE_<N>_REPORT.json   — metrics structurées
```

## Ordre d'exécution recommandé

1. **Phase 1** (1.1 déjà fait) → 1.2, 1.3, 1.4, 1.5, 1.6 en un seul PR derrière feature flag
2. Valider baseline → phase 1 Brier ↓ ≥ 0.02 → activer flag en prod
3. **Phase 2** : refonte complète, gros effort. A faire après avoir stabilisé la phase 1.
4. **Phase 3-4** : après avoir absorbé le gros du travail.

Sans Glicko (Phase 2), le Brier ne descendra probablement pas sous 0.19. Phase 1 seule devrait nous mettre à ~0.20-0.21 depuis baseline ~0.23-0.25.
