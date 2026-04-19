# Baseline Score Exact — V1 théorique (2026-04-19)

> ⚠️ **WARNING sample size** : N=138 matchs (répartis sur ~4 formats).
> Les chiffres par format sont sur ~5-15 observations chacun. **Aucune robustesse statistique**.
> Un swing de 3-4 matchs peut inverser n'importe quel classement.
> **À re-mesurer quand N ≥ 200 matchs COMPLETED** avant toute décision sur la V2.

## Résultats globaux
| N | RPS | Brier multi-class | Log-loss | Top-choice accuracy |
|---|---|---|---|---|
| 138 | 0.2045 | 0.7941 | 1.6657 | 24.6% |

## Par format
| Format | N | RPS | Brier | Log-loss | Top-acc |
|---|---|---|---|---|---|
| BO2 | 17 | 0.1582 | 0.5828 | 0.9474 | 35.3% |
| BO3 | 14 | 0.2272 | 0.7198 | 1.3276 | 50.0% |
| BO5 | 102 | 0.2122 | 0.8374 | 1.8205 | 19.6% |
| BO7 | 5 | 0.1423 | 0.8371 | 1.8978 | 20.0% |

## Skipped
| Raison | N |
|---|---|
| Score inattendu pour le format (ex: BO5 terminé 2-1) | 5 |

## 10 pires prédictions (par RPS)

| Format | Date | Matchup | Actual | Top predicted | P(top) | P(actual) | RPS |
|---|---|---|---|---|---|---|---|
| BO5 | 2026-04-12 | SAS vs Downfall | 3-1 | 0-3 | 65% | 1% | 0.637 |
| BO5 | 2026-04-18 | Lewis vs KingstoNe | 0-3 | 3-1 | 27% | 5% | 0.488 |
| BO5 | 2026-04-09 | Dark vs Sziky | 3-0 | 1-3 | 24% | 8% | 0.421 |
| BO5 | 2026-04-18 | Vinchester vs Vivi | 3-0 | 1-3 | 24% | 8% | 0.410 |
| BO5 | 2026-04-11 | Classicpro vs Mihai06 | 3-0 | 1-3 | 21% | 10% | 0.363 |
| BO5 | 2026-04-18 | Anotand vs CoRe | 3-0 | 1-3 | 21% | 10% | 0.360 |
| BO5 | 2026-04-16 | Barles vs WaRRioR | 3-0 | 1-3 | 21% | 10% | 0.359 |
| BO5 | 2026-04-11 | ACCM vs Classicpro | 0-3 | 3-1 | 20% | 11% | 0.340 |
| BO5 | 2026-04-17 | Classicpro vs JorDan AoE | 0-3 | 3-1 | 19% | 12% | 0.333 |
| BO5 | 2026-04-16 | Vivi vs Fedex | 3-0 | 1-3 | 19% | 12% | 0.327 |

---

## Lecture des chiffres

### Repères RPS (0 = parfait, plus bas = mieux)
- **Modèle aléatoire uniforme** sur 6 outcomes BO5 : RPS ≈ 0.33
- **Notre V1 BO5** : RPS **0.2122** → bat largement l'uniforme, mais il reste
  beaucoup de variance absolue (0.637 sur le pire cas).
- Target V2 réaliste (quand N ≥ 200) : **RPS ≤ 0.18** en BO5 pour valider
  une amélioration significative.

### Top-choice accuracy basse (24.6 % overall)
Le score prédit le plus probable sort **dans 1 match sur 4 seulement**. C'est
attendu parce que :
- Sur BO5 il y a 6 outcomes, baseline uniforme 16.7 %.
- Les 2 scores les plus probables concentrent souvent ~50 % de la masse →
  si le match se décide sur le 3ᵉ (ex. 3-2 qu'on prédit à 18 %), on "rate".
- Les 10 pires erreurs sont toutes des **matches où le favori a perdu**.
  La distribution BO5 est très déséquilibrée par le favori — elle
  pénalise lourdement les upsets même quand la proba du winner est à 60 %.

### BO2 vs BO5
BO2 a un RPS bien plus bas (0.158) parce que seulement 3 outcomes + la
distribution vient DIRECTEMENT des odds 3-way main (pas d'extrapolation
binomiale per-game). C'est attendu et ne veut PAS dire que la V1 BO2 est
"meilleure" — juste que c'est un problème plus simple.

### Diagnostic des 10 pires

**Tous** sont des matchs où le moteur binaire a mis le mauvais joueur
favori. Le Score Exact hérite automatiquement de cette erreur. Aucun des
10 worst n'est une "erreur propre au layer Score Exact" (coefficient
binomial faux, margin mal appliquée, etc.). Confirme l'audit étape 1 :
**la couche théorique binomiale est saine**.

---

## N=138 vs N=45 du backtest binaire — pourquoi ?

Le backtest binaire (`backtest-phase3-diagnostic`) filtre aux matchs où
**les 2 joueurs ont ≥ 1 PMR** avant la date (nécessaire pour calculer
`calculateOddsV2`). Beaucoup de matchs récents n'ont qu'un des 2 joueurs
avec historique → exclus.

Le backtest Score Exact ne fait QUE de la math binomiale à partir de
`odds1/odds2` déjà stockées en DB. Il ne recalcule pas le moteur, donc
prend tous les 138 matchs COMPLETED avec un `resultScore` parseable.

**Conséquence** : les deux N ne sont pas comparables. Une future V2 Score
Exact devra être backtesté sur ce même N=138 pour être directement
comparable à cette baseline.

---

## Mise en place du monitoring

- Cron weekly `weeklyOddsEngineBacktest` (lundi 3h UTC) fait désormais
  **les 2 backtests en une passe** : binaire + exact-score. Un seul snapshot
  `OddsBacktestSnapshot` est inséré avec les colonnes `exactScoreRPS`,
  `exactScoreBrier`, `exactScoreLogLoss`, `exactScoreN` (migration SQL
  appliquée — nullable pour la rétrocompat des anciennes lignes).
- **Warning 3-semaines** : si le RPS exact dégrade de ≥ 0.05 vs le snapshot
  de la semaine -3 sur les 3 snapshots les plus récents → `logger.warn`
  `[⚠️ ODDS_ENGINE_EXACT]` dans les logs Railway. Nécessite 4 snapshots
  avec `exactScoreRPS` non-null avant de pouvoir déclencher.

---

## Décision — on range

Conformément à la règle **"on ne passe pas à l'étape 3 tant que N < 200"** :

- **V1 reste en prod.** Aucun flag créé.
- **Pas d'implémentation V2** aujourd'hui.
- **Cron weekly** accumule les snapshots. Quand N ≥ 200 matchs COMPLETED,
  re-run ce baseline et décider si V2 vaut le coup.
- **À surveiller passivement** : le warning 3-semaines sur le RPS. Si
  déclenché → inspection manuelle.

### Hypothèses d'amélioration documentées pour le jour où on reprend

(Rappel de l'audit étape 1, à retenir pour la future V2) :

1. **MIN_ODDS explicite** à 1.05 sur le score exact — évite odds < 1 sur
   gros favori. Trivial, à faire même sans V2.
2. **Margin per-format** au lieu de 15 % flat — calibration fine.
3. **Momentum modeling** (gagner la map N → +5 pp sur N+1) — à confirmer
   empiriquement sur nos matchs.
4. **Tier-adjusted p** — en S-tier les matchs sont plus serrés, moins de
   sweeps 3-0.
5. **BO1 ≡ winner market** — fusionner ou ajouter disclaimer UX.
6. **Platt scaling multi-class** post-hoc — calibrer les probas extrêmes.

Aucune de ces features ne sera implémentée avant N ≥ 200.

---

## Fichiers

- Harness : [backend/src/services/exactScoreBacktestHarness.ts](../backend/src/services/exactScoreBacktestHarness.ts)
- CLI : [backend/scripts/backtest-exact-score.ts](../backend/scripts/backtest-exact-score.ts)
- Cron : [backend/src/cron/jobs.ts](../backend/src/cron/jobs.ts) (`runWeeklyOddsEngineBacktest`)
- Schema : [backend/prisma/schema.prisma](../backend/prisma/schema.prisma) — model `OddsBacktestSnapshot`