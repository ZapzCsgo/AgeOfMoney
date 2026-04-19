# Audit — Odds Engine

## État final (avril 2026)

- **V1 blended est en prod** — blending heuristique (WR 50% / form 30% / H2H 0-30% / tier 10%) avec opponent-strength + step-up penalty + draws 1-1 neutres.
  - Brier ~0.21, accuracy ~73% sur les backtests N=45.
- **V2 Glicko-2 (vanilla et tier-weighted) est committed mais dormant**. Tous les backtests Phase 2/3/4 montrent V2 pire que V1 sur le dataset actuel (120 joueurs, 4409 events, N=45 predictions valides). Phase 4 tier-weighted a même **aggravé** Phase 3 vanilla (Brier V2 0.3121 vs 0.2745). Cause racine mise à jour : dataset trop sparse — tier-weighting amplifie les mauvais signaux au lieu de les corriger.
  - Flag `ODDS_ENGINE_V2_ENABLED` par défaut **OFF** sur Railway.
- **Phase 3 (Ensemble + Platt scaling)** non implémentée. Si V2 seul est à +0.10 Brier de V1, ensemble serait mécaniquement pire. Pas d'investissement tant qu'on n'a pas plus de data.

## Comment ré-activer V2 (si besoin)

1. Vérifier que le cron `weeklyOddsEngineBacktest` a produit ≥ 3 snapshots où V2 blended bat V1 de ≥ 0.02 Brier. Chercher le warning `⚠️ ODDS_ENGINE V2 blended a battu V1…` dans les logs Railway.
2. Sur Railway → Variables → ajouter `ODDS_ENGINE_V2_ENABLED=true`.
3. Redéployer.
4. Monitorer les 10 prochains matchs : log warning si le Brier live dévie > 0.05 vs backtest.
5. Si régression → supprimer la variable, Railway redéploie V1.

## Courbes à surveiller

Le cron `weeklyOddsEngineBacktest` (lundi 3h UTC) produit un snapshot dans la table `OddsBacktestSnapshot`. Métriques suivies :

| Colonne | Signification |
|---|---|
| `v1Brier` | Brier score de V1 (prod actuel). Cible < 0.20. |
| `v2Brier` | Brier V2 blended (Glicko dans le blend). Si régulièrement < `v1Brier - 0.02` → activer V2. |
| `v2purBrier` | Brier V2 pur (Glicko seul). Signal si le blending aide/nuit Glicko. |
| `v1Accuracy` | Top-choice accuracy V1. Cible ≥ 65%. |
| `n` | Nombre de matchs valides dans le backtest (exclut draws). |

### Trigger d'action automatique

Le cron log un warning si, sur les **3 dernières semaines consécutives**, `v2Brier < v1Brier - 0.02`. Grep `⚠️ ODDS_ENGINE` dans les logs Railway pour voir ces alertes.

## Export local pour historisation

La filesystem Railway est ephemeral. Pour committer les snapshots dans le repo :

```bash
cd backend
DATABASE_URL='...' npx tsx scripts/export-weekly-backtests.ts
cd ..
git add audit/weekly
git commit -m 'docs(audit): weekly backtests'
git push origin master
```

## Rapports Phase 1-3 (à lire pour contexte)

Ordre chronologique — chacun construit sur le précédent.

1. [ODDS_ENGINE_UPGRADE_PLAN.md](ODDS_ENGINE_UPGRADE_PLAN.md) — plan initial 4 phases + table features priorisée
2. [BASELINE_ODDS_ENGINE_2026-04-19.md](BASELINE_ODDS_ENGINE_2026-04-19.md) — baseline V1 avant toute modification (Brier 0.24, accuracy 58%)
3. [PHASE1_V2_VALIDATION_2026-04-19.md](PHASE1_V2_VALIDATION_2026-04-19.md) — Phase 1 (time decay + momentum + SOS + rest + wrLogitDiff scale) : échec backtest, flag OFF
4. [PHASE2_GLICKO2_VALIDATION_2026-04-19.md](PHASE2_GLICKO2_VALIDATION_2026-04-19.md) — Phase 2 (Glicko-2 rating) : V2 pire que V1, flag OFF
5. [PHASE3_STOP_FOR_ANALYSIS_2026-04-19.md](PHASE3_STOP_FOR_ANALYSIS_2026-04-19.md) — Phase 3 bugs #1/#2 fixés : toujours pire, STOP
6. [PHASE3_DIAGNOSTIC_2026-04-19.md](PHASE3_DIAGNOSTIC_2026-04-19.md) — **Diagnostic final** : 3-config + analyse des 10 pires erreurs. 100% "rating faux" (RD > 150). Cause racine : Glicko ignore le tier.
7. [PHASE4_TIER_WEIGHTED_GLICKO_2026-04-19.md](PHASE4_TIER_WEIGHTED_GLICKO_2026-04-19.md) — Phase 4 (Glicko-2 tier-weighted) : spec + implémentation.
8. [PHASE4_BACKTEST_RESULTS_2026-04-19.md](PHASE4_BACKTEST_RESULTS_2026-04-19.md) — **résultats empiriques Phase 4** : Brier V2 0.3121 **pire** que V1 0.2104 et pire que Phase 3 vanilla 0.2745. Tier-weighting amplifie les mauvais signaux sur dataset sparse. Flag reste OFF, Phase 4 rangée.

## Code references

- Moteur principal : [backend/src/services/oddsEngine.ts](../backend/src/services/oddsEngine.ts)
- Math Glicko-2 pure : [backend/src/services/glicko2.ts](../backend/src/services/glicko2.ts)
- DB wrapper Glicko : [backend/src/services/ratingEngine.ts](../backend/src/services/ratingEngine.ts)
- Backtest harness : [backend/src/services/backtestHarness.ts](../backend/src/services/backtestHarness.ts)
- Cron weekly : [backend/src/cron/jobs.ts](../backend/src/cron/jobs.ts) (fonction `runWeeklyOddsEngineBacktest`)
- Export script : [backend/scripts/export-weekly-backtests.ts](../backend/scripts/export-weekly-backtests.ts)
- Règles métier (skill) : [.claude/skills/odds-engine-aoe4/SKILL.md](../.claude/skills/odds-engine-aoe4/SKILL.md)

## À reprendre seulement si

- **N ≥ 200 matchs COMPLETED valides** (actuellement ~45). Avec plus de sample, les stats se stabilisent.
- **Glicko tier-weighted** développé (score update multiplié par TIER_WEIGHT : S=4, A=2, etc.). **Fait en Phase 4** — code mergé, rebuild+backtest à lancer avec pooler URL (cf. [PHASE4_TIER_WEIGHTED_GLICKO_2026-04-19.md](PHASE4_TIER_WEIGHTED_GLICKO_2026-04-19.md) §4.1).
- **Ensemble V1 × V2** tenté SEULEMENT si V2 blended est dans ±0.02 Brier de V1. Aujourd'hui écart > 0.06 → ensemble garantit une régression.
