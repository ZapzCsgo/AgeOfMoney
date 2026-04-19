# Phase 3 — Arrêt pour analyse (2026-04-19)

## TL;DR

Les 2 bugs Phase 3 ont été fixés et rebuild live appliqué :
- ✅ **Bug #1** (single-game → match-level binomial) : unit test `p=0.7` PASS sur BO1/2/3/5/7
- ✅ **Bug #2** (RD inflation chronologique) : re-rebuild prod, RD des vétérans remonté (ex: 60→88)

Mais **V2 Glicko est TOUJOURS pire que V1** après fixes. Le spec dit :
> Si encore pire → tu me dis et on s'arrête là pour analyse.

Flag reste OFF. Ensemble + Platt pas implémentés tant qu'on n'a pas compris pourquoi V2 sous-performe.

## Chiffres après fixes (45 matchs valides)

| Métrique | V1 | V2 avant fixes | V2 après fixes | Δ vs V1 |
|---|---|---|---|---|
| Brier | **0.2104** | 0.2543 | 0.2745 | +0.064 🔴 |
| Log-loss | **0.6113** | 0.7014 | 0.7520 | +0.141 🔴 |
| Accuracy | **73.3%** | 56.5% | 55.6% | -17.7 pts 🔴 |

**V1 reste significativement meilleur**. Les fixes ont même légèrement empiré V2 en amplifiant les prédictions incorrectes (puisque Glicko donne maintenant une prob match-level plus confiante).

## Calibration curve

Problème frappant : V2 dans le bucket 70-80% prédit 73.6% mais actual seulement 50% (n=4). Le modèle Glicko est over-confident sur les matchs "moyennement favoris" alors qu'il devrait l'être moins. Ce symptôme est typique d'un modèle qui n'a pas de correction pour la variance intra-match (momentum, forme jour J).

## Hypothèses pour l'échec de Glicko

1. **Dataset sub-optimal pour Glicko pur** : 23509 PMR rows dont beaucoup très anciens (dès 2009). Le rating converge mais reflète une carrière entière, pas la forme actuelle.
2. **Variance inter-match non modélisée** : Glicko assume que P(game) est constant conditionnel au skill. En esport, le momentum, la fatigue, le stress du match importent. V1 blend capture ces signaux via form/H2H.
3. **Sample trop petit** : 45 matchs valides. Un swing de 8 matchs sur la diagonale 0.5 change l'accuracy de 18 pts. Peut-être du bruit.
4. **V1 est étonnamment bon** : 73.3% top-choice accuracy, Brier 0.2104 — c'est difficile à battre sans un dataset significativement plus riche.

## Décision

**On arrête Phase 3 avant d'implémenter Ensemble + Platt**. Justification :

- Si V2 seul est pire que V1 (écart 0.064 Brier, 17.7 pts accuracy), ensemble `0.5 × V1 + 0.5 × V2` sera mécaniquement pire que V1. On irait dans le mur.
- Platt scaling corrige la calibration, pas l'accuracy. Or notre problème est l'accuracy (qui est le favori), pas la calibration (à quel point).
- Investir dans Ensemble/Platt sans comprendre pourquoi Glicko sous-performe = prématuré.

## Next steps candidats (à choisir ensemble)

1. **Plus de data** : attendre 200+ matchs valides avant de conclure définitivement. Avec N=200, on pourrait avoir un signal plus fiable.
2. **Glicko SEUL (sans blending)** : tester si `prob = seriesWinProb(glickoP, format)` sans form/H2H/tier est pire ou meilleur que V1. Si meilleur seul → blending est le coupable.
3. **Diagnostic match-par-match** : prendre les 10 matchs où V2 se trompe le plus, examiner les ratings Glicko des 2 joueurs, comprendre si le rating est faux (data issue) ou si le match était vraiment un upset imprévisible.
4. **Backtest V1+Form SANS WR** : tester une version de V1 qui retire la WR et ne garde que form + H2H + tier. Si elle bat V1 complet, le WR est le problème → Glicko ne peut pas juste remplacer le WR.
5. **Simplifier Glicko à Elo pur** : τ=0 (pas de volatility), RD fixée à 200. Moins de degrés de liberté, peut-être plus stable sur notre dataset limité.

## Code state

- ✅ Glicko-2 implementation correcte (test canonique PASS)
- ✅ Rebuild chronologique avec RD inflation (4407 events, 120 joueurs, top 25 sensé)
- ✅ Intégration oddsEngine (bug #1 fixed : seriesWinProb, #2 fixed : inflateRd)
- ✅ Hook live update dans liquipediaLiveScorer (gated par flag)
- ❌ Ensemble V1×V2 : pas implémenté
- ❌ Platt scaling : pas implémenté
- ❌ Flag `ODDS_ENGINE_V2_ENABLED` : reste OFF
- ❌ Flag `ODDS_ENGINE_ENSEMBLE_ENABLED` : pas créé
- ❌ Flag `ODDS_ENGINE_PLATT_ENABLED` : pas créé

## Prod state

100% inchangé — V1 continue de tourner, aucun impact utilisateur. Le code Phase 2 + bug fixes sont committés (`9b2a7d4`, `9cb3565`) mais dormants derrière Glicko being off via le contrôle caller-side.

## Commits Phase 3

- `9b2a7d4` : bug #1 — seriesWinProb + unit test
- `9cb3565` : bug #2 — RD inflation chronologique
- `c68ec04` : emoji coinflip fix (non-related mais dans le scope)
- (à venir) : ce rapport

## Question à trancher

Quelle direction veux-tu explorer (1/2/3/4/5 ci-dessus), ou veux-tu passer à autre chose en attendant plus de data ?
