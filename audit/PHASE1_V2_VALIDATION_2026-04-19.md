# Phase 1 V2 — résultat backtest (2026-04-19)

## Résultat : **négatif, Phase 1 ne part PAS en prod**

Comparaison sur les 30 derniers matchs COMPLETED (26 valides hors draws) :

| Métrique | V1 (actuel) | V2 (Phase 1) | Δ | Verdict |
|---|---|---|---|---|
| **Brier score** | 0.2372 | **0.2501** | +0.0129 | 🔴 pire |
| **Log-loss** | 0.6651 | **0.6907** | +0.0256 | 🔴 pire |
| **Top-choice accuracy** | 57.7% | **42.3%** | -15.4pts | 🔴 pire que random |
| Book ROI simulé | 11.32% | 11.32% | = | = |

## Diagnostic

Phase 1 visait à corriger la **sous-calibration** (modèle trop mou → pousse vers 50/50). Les 5 features (time decay plus court, wrLogitDiff × 1.15, momentum, rest non-linéaire, SOS) augmentent toutes la **confidence du modèle** sur ses prédictions.

**Problème** : la baseline V1 a déjà un top-choice accuracy de 57.7% → on se trompe de favori 42% des fois. Quand tu ampifies un mauvais signal, tu obtiens un pire signal.

Les features Phase 1 agissent sur la **magnitude** du signal (on est plus confident), pas sur sa **direction** (qui est le vrai favori). On amplifie les erreurs plus qu'on n'améliore la précision.

Regarder la courbe de calibration :

| Bucket | V1 predicted | V1 actual | V2 predicted | V2 actual |
|---|---|---|---|---|
| 30-40% | 38% | 100% | 37% | 100% |
| 40-50% | 45% | 67% | 48% | 83% |
| 50-60% | 54% | 60% | 54% | **33%** ⚠️ |
| 60-70% | 64% | 75% | 66% | 71% |
| 70-80% | 77% | 100% | 77% | 100% |

Le bucket 50-60% de V2 est catastrophique (33% réel vs 54% prédit) — on dit "favori léger" mais on perd 2/3 du temps dans cette zone. En V1 c'était bien calibré (60% actuel). Phase 1 a cassé un bucket qui marchait.

## Conclusions

1. **V1 reste en prod** (flag `ODDS_ENGINE_V2_ENABLED=false` par défaut, on ne touche PAS Railway). Phase 1 laissée derrière le flag pour pouvoir y revenir si on veut tester sur plus de data.

2. L'échantillon est petit (26 matchs valides) mais la tendance est cohérente : Brier ↑, log-loss ↑, accuracy ↓. Pas du bruit.

3. **Prochaine étape = Phase 2 directement** : Glicko-2 rating est le vrai pas en avant. Il résout l'accuracy avant la confidence. Notre problème est "qui est le favori ?", pas "à quel point il est favori ?".

4. Le code V2 reste committé (`9e9581e`) — il n'active rien, mais si on veut l'activer ponctuellement en dev pour comparer après Phase 2, c'est immédiat.

## Retrospective : pourquoi Phase 1 a foiré

- **Hypothèse initiale** : baseline sous-calibré (vrai) + confidence insuffisante (faux). La calibration était biaisée mais la confidence était correcte pour la qualité du signal disponible. Augmenter la confidence a cristallisé les erreurs.
- **Leçon** : avant de toucher la magnitude d'un signal, vérifier que la direction est bonne. Mesurer accuracy AVANT confidence.
- **Feature flag a fait son job** : rien n'est cassé en prod, la régression est restée locale au backtest.

## Next actions

- [ ] Lancer Phase 2 : créer le service `ratingEngine.ts` (Glicko-2), table `PlayerRating`, one-shot rebuild chronologique.
- [ ] Remplacer `computeCompetitiveWinrate` par `rating-based P(win)` dans `calculateOddsV2`.
- [ ] Re-baseline après Phase 2 : cible Brier ≤ 0.19, accuracy ≥ 65%.
- [ ] Si Phase 2 réussit, RÉACTIVER certaines features Phase 1 (momentum, rest factor) qui sont sensées en elles-mêmes mais ont besoin d'un rating correct comme base.
