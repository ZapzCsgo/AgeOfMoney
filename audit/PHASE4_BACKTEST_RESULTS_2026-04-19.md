# Phase 4 — résultats empiriques tier-weighted Glicko (2026-04-19)

**TL;DR** : tier-weighted Glicko **dégrade** le Brier vs Phase 3 vanilla Glicko
(0.3121 vs 0.2745) et reste **largement pire que V1 prod** (0.2104). L'hypothèse
"Glicko ignore le tier → rating faux" est **infirmée** sur ce dataset : avec
N=45 predictions et beaucoup de joueurs sparse, les tier weights amplifient
les mauvais signaux au lieu de les corriger. **Flag reste OFF.**

---

## 1. Setup

- **Rebuild** : `scripts/rebuild-ratings.ts` relancé avec TIER_WEIGHTS
  (S=4.0, Qualifier=2.5, A=2.0, B=1.0, C=0.4, Showmatch/Misc=0.3).
- **Events replayed** : 4 409 (platform + PMR, deduped, 2009-03-07 → 2026-04-19).
- **Rows persisted** : 120 `PlayerRating` (min 10 games / joueur).
- **Top 25 après rebuild tier-weighted** (sanity PASS — pas de farmer hebdo en top 10, tous ≥ 50 games, RD < 90) :

  ```
   1. Beastyqt (AoE4)           2438 ±84  51g
   2. MarineLorD (AoE4)         2368 ±58  141g
   3. Liereyy (AoE2)            2251 ±56  175g
   4. Wam01 (AoE4)              2218 ±59  196g
   5. TheViper (AoE2)           2093 ±57  142g
   6. VortiX (AoE4)             2068 ±61  172g
   7. Bee (AoE4)                2052 ±76  91g
   8. LucifroN (AoE4)           2050 ±69  170g
   9. Yo (AoE2)                 2047 ±54  85g
  10. Sebastian (AoE2)          2015 ±53  180g
  11. 1puppypaw (AoE4)          2002 ±58  154g
  12. TaToH (AoE4)              1944 ±62  173g
  13. Chim Sẻ Đi Nắng (AoE4)    1932 ±65  114g
  14. Anotand (AoE4)            1919 ±82  50g
  15. Hearttt (AoE2)            1915 ±54  131g
  16. ACCM (AoE2)               1897 ±49  161g
  17. Sitaux (AoE2)             1878 ±55  128g
  18. Vinchester (AoE2)         1841 ±54  106g
  19. FreakinAndy (AoE4)        1797 ±55  178g
  20. Nicov (AoE2)              1797 ±57  160g
  21. Numudan (AoE4)            1797 ±65  114g
  22. Lewis (AoE2)              1772 ±56  88g
  23. MbL (AoE2)                1741 ±53  185g
  24. Vivi (AoE2)               1728 ±55  59g
  25. DauT (AoE2)               1727 ±56  143g
  ```

  Note : Hera, JiNoo, Huuh et d'autres pros AoE4 attendus sont **absents du DB** (scraper ne les a pas encore — 76 joueurs AoE4 totaux seulement). Ce n'est pas un défaut des tier weights.
- **Backtest** : `scripts/backtest-phase3-diagnostic.ts --n=50`, N=45 predictions
  valides (3 draws exclues, 2 matchs sans H2H skipped).
- **Internal replay** : patché pour utiliser `tierWeight(ev.tournamentTier)`
  dans `computeUpdatedRating`, cohérent avec le rebuild LIVE.

---

## 2. Résultats — 3 configs

| Config | Brier | Log-loss | Accuracy |
|---|---|---|---|
| **A — V1 blended** (prod actuel, heuristique) | **0.2104** | **0.6113** | **73.3%** |
| B — V2 blended (Glicko tier-weighted dans le blend) | 0.3121 | 0.8751 | 53.3% |
| C — V2 pur (Glicko tier-weighted + binomiale BO3/5) | 0.3694 | 1.0812 | 51.1% |

Meilleur Brier : **A (V1 prod)** — ne change pas par rapport aux Phases 1-3.

---

## 3. Comparaison Phase 3 → Phase 4

| Config | Phase 3 Brier | Phase 4 Brier | Δ | Phase 3 Acc | Phase 4 Acc | Δ |
|---|---|---|---|---|---|---|
| V1 blended | 0.2104 | 0.2104 | **0.0000** (identique, pas touché) | 73.3% | 73.3% | 0.0 pp |
| V2 blended | 0.2745 | 0.3121 | **+0.0376** (pire) | 55.6% | 53.3% | −2.3 pp |
| V2 pur | 0.3213 | 0.3694 | **+0.0481** (pire) | 46.7% | 51.1% | +4.4 pp |

**Lecture** :
- Tier-weighting **a empiré** V2 blended et V2 pur sur le Brier.
- V2 pur gagne un peu sur l'accuracy (bonnes prédictions top-choice) mais
  perd beaucoup sur la calibration (probabilités plus confiantes donc mieux
  quand elles tombent juste et bien pires quand elles tombent mal → signe
  que le ratio "confiance vs bonne direction" s'est dégradé).

---

## 4. Calibration comparée (buckets 10%)

| Bucket | V1 pred | V1 act | V2 pred | V2 act | V2pur pred | V2pur act | n_V1 |
|---|---|---|---|---|---|---|---|
| 0-10% | 0% | 0% | 8% | 100% | 8% | 73% | 0 |
| 10-20% | 0% | 0% | 18% | 50% | 16% | 67% | 0 |
| 20-30% | 0% | 0% | 24% | 80% | 25% | 100% | 0 |
| 30-40% | 36% | 67% | 34% | 83% | 38% | 50% | 3 |
| 40-50% | 45% | 44% | 43% | 50% | 44% | 100% | 9 |
| 50-60% | 55% | 80% | 52% | 100% | 50% | 75% | 20 |
| 60-70% | 65% | 82% | 66% | 100% | 65% | 100% | 11 |
| 70-80% | 73% | 100% | 72% | 50% | 74% | 50% | 2 |
| 80-90% | 0% | 0% | 82% | 75% | 85% | 67% | 0 |
| 90-100% | 0% | 0% | 92% | 67% | 92% | 71% | 0 |

**Observations** :
- V1 concentre 89 % de ses prédictions dans les buckets 40-70 % (under-confident,
  calibré correctement).
- V2 s'étale sur TOUS les buckets (très confiant dans les extrêmes 0-20 % et
  80-100 %) — mais ces prédictions extrêmes **ratent**. Les buckets 0-30 %
  devraient avoir ≤ 30 % d'actual, ils ont 50-100 %.
- V2 est systématiquement **over-confident dans le mauvais sens** → le modèle
  prédit qu'un favori va gagner ~92 %, et dans 33-67 % des cas le joueur
  considéré "faible" gagne.

---

## 5. Catégorisation des 10 pires erreurs V2

Identique à Phase 3 :

| Catégorie | Phase 3 | Phase 4 |
|---|---|---|
| a) Vraie upset (correcte, juste malchance) | 0 % | 0 % |
| **b) Rating faux** (RD > 150 ou données sparse) | **100 %** | **100 %** |
| c) Model inadéquat (binomiale mal calibrée) | 0 % | 0 % |

→ Phase 4 **n'a pas réduit la catégorie "rating faux"**. Pire : le rating
continue d'être à 1165 ± 209 (~335 pts sous le default avec RD mi-haut) pour
tous les upsets. Les tier weights amplifient les early losses des joueurs
sparse au lieu de les corriger.

Exemples :
- **Ciskhan vs Prisma09 (BO5 tier S)** : V2 prédit Ciskhan 92 % → Prisma09 gagne.
  Prisma09 est à 1165 ± 209 dans le rating tier-weighted (a joué presque
  exclusivement en tier B, mais tier B = weight 1 donc signal faible).
- **Classicpro vs JorDan AoE (BO5 tier S)** : V2 prédit Classicpro 80 % →
  JorDan gagne. JorDan a W 3-0 en Qualifier contre Flying Mouse, W 4-1 Misc
  contre DauT, mais les wins Qualifier (weight 2.5) sont mal pondérées vs
  les losses B (weight 1) → rating global sous-évalué.

**Diagnostic secondaire** : le weight système amplifie le signal **à la fois
dans le bon et le mauvais sens**. Sur un dataset sparse, les mauvais signaux
dominent car il y a peu de diversité de tiers par joueur pour se compenser.

---

## 6. Verdict

```
Critère go-live : Brier V2 ≤ Brier V1 − 0.02  ET  Accuracy V2 ≥ Accuracy V1
→ Phase 4 : Brier V2 − Brier V1 = +0.1017  (devrait être ≤ −0.02)
           Accuracy V2 − Accuracy V1 = −20.0 pp  (devrait être ≥ 0)
→ ÉCHEC sur les 2 critères. Marge ÉNORME.
```

**Décision** : `ODDS_ENGINE_V2_ENABLED` reste **OFF**. Aucune activation.

---

## 7. Ce qu'on a appris (et ce qu'on range)

### Appris

1. **Glicko seul n'est pas adapté au dataset AoE4 actuel** (N=45, ~120 joueurs,
   beaucoup sparse). Ce n'était pas un bug de calibration des tiers, ni un bug
   de bucketing match-level, ni un bug de RD inflation — Phases 2, 3, 4 ont
   chacune corrigé un facteur sans changer la conclusion.
2. **Tier-weighting ≠ remède sparse-data**. Sur un dataset riche (Chess.com
   avec N=100k+ par joueur), la pondération stabilise. Sur N=45 matchs test
   avec joueurs à faible historique, elle **aggrave** car chaque match pèse
   plus, donc chaque erreur pèse plus.
3. **V1 prod est un benchmark dur à battre sur ce volume**. Heuristique blend
   simple (WR 50 % / form 30 % / H2H 0-30 % / tier 10 %) fait 73 % accuracy
   et 0.21 Brier. Ce n'est pas "juste du bruit" qu'on va battre en lançant
   Glicko dessus.

### Rangé (par rapport au plan initial)

- [ODDS_ENGINE_UPGRADE_PLAN.md](ODDS_ENGINE_UPGRADE_PLAN.md) — Phases 1-4
  toutes closes, aucune n'a activé son flag en prod.
- Le code Glicko tier-weighted reste committed, dormant, reproductible.
- Cron `weeklyOddsEngineBacktest` continue de mesurer V1 vs V2 chaque lundi.
  Si un jour V2 bat V1 de ≥ 0.02 Brier sur 3 semaines consécutives → warning
  dans les logs Railway → on ré-évalue (cf. [audit/README.md](README.md) §
  "Comment ré-activer V2").

### À ne **pas** tenter tant que N < 200

- Ensemble V1 × V2 : quand V2 est à 0.10+ Brier de V1, le blend garantit une
  régression.
- Platt scaling sur V2 : calibre le modèle mais ne répare pas un modèle qui
  prédit mal. Échec garanti sur dataset sparse.
- TIER_WEIGHTS re-calibrés (S=3, C=0.6 etc.) : attaque un paramètre, pas
  la cause racine ("pas assez de data par joueur"). Irréaliste que ça
  renverse +0.10 Brier.

### À essayer quand N ≥ 200 (futur lointain)

- Rejouer ce même backtest avec tier-weighted Glicko sur dataset enrichi.
  Si V2 ≤ V1 − 0.02, activer.
- ELO tournament-only (approche Betway simplifiée) si Glicko reste mort
  même à N=200.
- H2H booster pondéré par récence + tier (approche Pinnacle esport).

---

## 8. Fichiers liés

- [PHASE4_TIER_WEIGHTED_GLICKO_2026-04-19.md](PHASE4_TIER_WEIGHTED_GLICKO_2026-04-19.md) — spec Phase 4 (math + implémentation).
- [PHASE4_BACKTEST_DETAIL_2026-04-19.md](PHASE4_BACKTEST_DETAIL_2026-04-19.md) — dump brut 3-configs + 10 pires erreurs.
- [PHASE3_DIAGNOSTIC_2026-04-19.md](PHASE3_DIAGNOSTIC_2026-04-19.md) — diagnostic vanilla Glicko, point de comparaison.
- [BASELINE_ODDS_ENGINE_2026-04-19.md](BASELINE_ODDS_ENGINE_2026-04-19.md) — V1 baseline.
- [README.md](README.md) — état global du moteur.
