# Phase 6 — Validation du fix overround (V2) (2026-04-19)

**Flag** : `ODDS_ENGINE_EXACT_V2_ENABLED` (default OFF sur Railway).
**V1 reste en prod** jusqu'à arbitrage manuel du user.

---

## Résumé exécutif

| Critère | Cible | Résultat V2 | Verdict |
|---|---|---|---|
| 8/8 cas Test 1 avec overround ∈ [1.14, 1.20] | OK | **8/8 ✅** (worst 1.1975) | ✅ PASS |
| RPS V2 ≤ RPS V1 + 0.01 | OK | **Identique par construction** (harness lit les probas théoriques, pas les odds) | ✅ PASS |
| Overround empirique sur 143 matchs COMPLETED | ≤ V1 | **Moyenne 1.1765 (V2) vs 1.1833 (V1)**, zéro match > 1.20 | ✅ PASS |

**Recommandation** : 🟢 **ACTIVE `ODDS_ENGINE_EXACT_V2_ENABLED=true` sur Railway.** Les 3 critères sont remplis. Aucune régression détectée.

---

## Test 1 — 8 cas edge, V1 vs V2

Overround = Σ(1/odds) sur tous les scores d'un match. Cible industrielle
17.6 % (margin 15 % ⇒ overround 1/(1-0.15) = 1.1765).

| Cas | V1 overround | V2 overround | Δ (user gain) |
|---|---|---|---|
| favori écrasant BO3 (1.05/15) | **1.2995** ❌ | **1.1765** ✅ | 12.3 pp |
| favori écrasant BO5 (1.05/15) | **1.3986** ❌ | **1.1765** ✅ | 22.2 pp |
| favori écrasant BO7 (1.05/15) | **1.4925** ❌ | **1.1975** ✅ | 29.5 pp |
| gros favori BO2 draw 8 (1.08/10) | 1.1765 ✅ | 1.1765 ✅ | 0 pp (cap pas touché) |
| favori marqué BO5 (1.25/4) | **1.2255** ❌ | **1.1765** ✅ | 4.9 pp |
| 50/50 BO5 (1.9/1.9) | 1.1765 ✅ | 1.1765 ✅ | 0 pp (cap pas touché) |
| underdog BO3 (3/1.4) | 1.1765 ✅ | 1.1765 ✅ | 0 pp (cap pas touché) |
| upset écrasant BO7 (10/1.05) | **1.4601** ❌ | **1.1783** ✅ | 28.2 pp |

**V1 : 4/8 KO** (tous sur matchs déséquilibrés où le cap MAX_ODDS=10 s'activait).
**V2 : 8/8 OK.** Worst overround 1.1975 (BO7 favori écrasant) — à la limite haute
acceptable, conforme [1.14, 1.20].

### Exemple concret — Favori écrasant BO5 (odds main 1.05 / 15)

| Score | Fair proba | V1 odd | V2 odd | Δ user (V2 - V1) |
|---|---|---|---|---|
| 3-0 | 49.4 % | 1.72 | **2.16** | +0.44 (+26 %) |
| 3-1 | 31.0 % | 2.74 | **3.43** | +0.69 (+25 %) |
| 3-2 | 13.0 % | 6.54 | **8.20** | +1.66 (+25 %) |
| 2-3 | 3.4 % | 10.00 (capped) | 10.00 (capped) | 0 |
| 1-3 | 2.2 % | 10.00 (capped) | 10.00 (capped) | 0 |
| 0-3 | 0.9 % | 10.00 (capped) | 10.00 (capped) | 0 |

Lecture : sous V1, le user qui parie sur 3-0 (49 % de chance) est payé 1.72×
(margin effective ~34 % sur ce score spécifique, car l'overround total 1.40 est
absorbé par les scores capped). Sous V2, le user est payé 2.16× (margin ~15 %
conforme). **Les scores cappés restent à 10** — pas de détérioration côté
book sur le camp underdog.

---

## Test backtest — RPS V1 vs V2

Par construction, `exactScoreBacktestHarness.ts` calcule le RPS à partir de
la **distribution théorique binomiale** directement (voir ligne 163,
`theoreticalDistribution`). V2 est un pur post-traitement odds/margin — il
ne touche PAS à la distribution. Donc :

| Métrique | V1 | V2 | Δ |
|---|---|---|---|
| RPS global | 0.2045 | **0.2045** | 0.0000 |
| Brier global | 0.7941 | **0.7941** | 0.0000 |
| Log-loss global | 1.6657 | **1.6657** | 0.0000 |
| Top-choice accuracy | 24.6 % | **24.6 %** | 0.0 pp |

**C'est attendu et souhaitable** : la qualité prédictive du moteur est
inchangée. V2 fixe uniquement la house-edge calibration, pas le modèle.

Critère user : RPS V2 ≤ RPS V1 + 0.01 → **0.0000 ≤ 0.01 ✅**.

---

## Overround empirique sur 143 matchs COMPLETED

Script : [backend/scripts/v1-vs-v2-overround-compare.ts](../backend/scripts/v1-vs-v2-overround-compare.ts)

Calcule pour chaque match COMPLETED l'overround actuel (V1) et ce qu'il
serait sous V2, à partir des odds1/odds2/oddsDraw stockées en DB.

| Format | N | V1 moyen | V1 max | V2 moyen | V2 max | Gain moyen user |
|---|---|---|---|---|---|---|
| BO2 | 18 | 1.1779 | 1.2018 | 1.1765 | 1.1765 | **0.14 pp** |
| BO3 | 16 | 1.1765 | 1.1765 | 1.1765 | 1.1765 | 0.00 pp |
| BO5 | 104 | 1.1832 | **1.4689** | 1.1765 | 1.1765 | **0.67 pp** |
| BO7 | 5 | 1.2278 | 1.2292 | 1.1766 | 1.1769 | **5.12 pp** |

**Global (N=143)** :
- V1 : overround moyen **1.1833**, max **1.4689** (47 % de margin sur un match BO5)
- V2 : overround moyen **1.1765**, max **1.1769**
- V1 matchs avec overround > 1.20 : **13 / 143 (9.1 %)**
- V2 matchs avec overround > 1.20 : **0 / 143**
- V1 matchs hors-norme (> 1.25) : 2 / 143
- V2 matchs hors-norme : 0

**Lecture** : sous V1, dans la vraie vie 9 % des matchs sortaient avec
une margin au-dessus de la cible industrielle. Sur 2 matchs spécifiques,
la margin dépassait 25 %. Sous V2, **zéro match** dépasse 20 %. BO7 — peu
de volume actuellement — bénéficie le plus (**+5.12 pp** de margin rendus
au user en moyenne).

---

## Implémentation

Fichier : [backend/src/routes/bets.ts](../backend/src/routes/bets.ts)

### Logique V2 (nouveau `distributionToEntriesV2`)

```
1. Normaliser probas à somme = 1 (blend peut dévier)
2. Appliquer margin globale : implied_i = p_i / (1 - 0.15)
   → total implied target = 1/0.85 = 1.1765
3. Identifier les scores dont implied < 1/10 = 0.10 (odds > 10 → cappés)
4. Forcer cappés à implied = 0.10 (odds = 10)
5. Scale les NON-cappés : scale = (1.1765 - N_cap × 0.10) / sum_implied_non_cappés
   → le sum total reste = 1.1765 exactement
6. Odds = 1/implied, cap MAX=10 en post-traitement (UX safety)
7. Round à 2 décimales
```

### Fallback dégénéré

Si TOUS les scores sont cappés (possible en BO7 très déséquilibré avec 8
outcomes — mathematically on a 8 × 0.10 = 0.80 < 1.1765, donc normalement
on a toujours des non-cappés), la V2 retombe sur `max(IMPLIED_CAP, implied_original)`
comme V1 en fallback silencieux.

### Dispatcher

```ts
function emitEntries(dist: ScoreDistribution): ScoreEntry[] {
  if (process.env.ODDS_ENGINE_EXACT_V2_ENABLED === 'true') {
    return distributionToEntriesV2(dist);
  }
  return distributionToEntries(dist);
}
```

Tous les call-sites (`exactScoreOdds`, `exactScoreOddsBlended`) passent
par `emitEntries`. Zéro code dupliqué, flag unique.

---

## Flag Railway

**Variable à ajouter sur Railway → backend → Variables** :

```
ODDS_ENGINE_EXACT_V2_ENABLED = true
```

Redeploy auto. À retirer pour rollback immédiat V1.

### Vérification post-activation

1. Ouvrir un match BO5 ou BO7 sur https://ageof.money avec un gros écart
   (odds1 < 1.20 par ex.). Check les cotes Score Exact affichées.
   - Les cotes "favori sweep" (3-0, 4-0) doivent être visiblement plus
     généreuses qu'avant activation.
   - Les cotes "upset" capées à 10.00 restent à 10.00.
2. Check les logs Railway :
   ```
   grep "ExactScore" logs → rien d'anormal attendu
   ```
3. Test POST /bets/exact sur un match BO5 — doit accepter, placer le bet,
   crediter au settlement exactement comme avant (V2 ne change pas la
   mécanique settlement, juste l'affichage des odds).

### Rollback

Supprimer la variable `ODDS_ENGINE_EXACT_V2_ENABLED` sur Railway. Redeploy.
V1 reprend immédiatement.

---

## Files modifiés / ajoutés

- [backend/src/routes/bets.ts](../backend/src/routes/bets.ts) — V2 + dispatcher + early-return BO1
- [backend/scripts/stress-test-exact-score.ts](../backend/scripts/stress-test-exact-score.ts) — distToOddsV1/V2 miroirs
- [backend/scripts/v1-vs-v2-overround-compare.ts](../backend/scripts/v1-vs-v2-overround-compare.ts) — NOUVEAU — comparaison empirique
- [audit/PHASE6_FIX_OVERROUND_VALIDATION_2026-04-19.md](PHASE6_FIX_OVERROUND_VALIDATION_2026-04-19.md) — ce rapport
