# Overnight Run #2 — 2026-05-02 (odds + egress)

Branche : `odds-overnight-2026-05-02` (créée depuis master, NON pushée).
Mode : OFFLINE forcé — Supabase injoignable depuis le devbox local toute la nuit
(timeout `db.xhusoizxbjkybcafvuss.supabase.co:5432`). Per consigne user, DB
inaccessible = bascule immédiate sur les phases offline.

## TL;DR (lit en 90 s)

- ✅ **2 commits** sur la branche : optim egress (~10 GB/mois économisés
  estimés) + 15 nouveaux variants odds + Monte Carlo score exact (10 tests
  passent).
- ✅ **3 commits master (avant la branche)** : Bug #1 WTL filter, Bug #2/#3
  hydration roulette + CSP CF Insights, + 4 chore commits qui vidaient le
  working tree.
- 🔴 **DB toujours down toute la nuit** → Phases 2/3/6 (snapshot + run live
  des 35 variants + comparatif final empirique) **non exécutées**. Code prêt,
  une seule commande au réveil.
- ⏭️ **Civ matchup + map preference** non implémentés : la table PMR ne
  stocke ni civ ni map par game. Ce n'est pas un bug du runtime, c'est un
  schéma à étendre + un scraper à brancher. Tracked en Top-actions §5.

## Phases — état détaillé

| # | Phase | Statut | Sortie |
|---|-------|--------|--------|
| 0 | Pre-flight DB check | ✅ DB confirmed DOWN → mode OFFLINE | n/a |
| 1 | Audit egress prod queries | ✅ | `audit/EGRESS_AUDIT_2026-05-02.md` |
| 2 | Snapshot UNE FOIS | ❌ blocked DB | _user action requise_ |
| 3 | Run baseline 20 variants | ❌ blocked snapshot | harness prêt |
| 4 | 15 nouveaux variants | ✅ committés (`variants.ts` ligne 153+) | _runs once snapshot exists_ |
| 5 | Score exact Monte Carlo | ✅ service + tests + variant v36 | `services/odds/exactScore.ts` (10/10 tests pass) |
| 6 | Run final + comparatif | ❌ blocked snapshot | _user action_ |
| 7 | Optim egress prod | ✅ committé en même temps que Phase 1 | code + doc |
| 8 | Bugs prod (3) | ✅ déjà fait avant la branche (master) | 3 commits master |
| 9 | Rapport final | ✅ ce fichier | — |

## Commits sur cette branche

```
0617461 feat(odds): 15 new tunable variants + exact-score Monte Carlo (Phases 4+5)
05516e5 feat(egress): cache PMR + select-only fixes for top 5 cron sinks
```

## Top 3 variants recommandés

> **Ces tops sont _hypothétiques_** — basés sur l'intuition stat de chaque
> override + l'analyse Phase 3/4 antérieure (audit/PHASE3_DIAGNOSTIC).
> À valider empiriquement dès que le snapshot est pris.

### #1 candidat : `s2-half-life-30d`
- **Pourquoi** : sweet spot entre 14d (overfit aux 2 dernières semaines) et
  90d (réagit pas assez aux meta shifts AoE2/AoE4).
- **Métrique attendue** : Brier baseline ≈ 0.21 → cible ≤ 0.20.
- **Egress impact** : 0 — pure code, pas de nouvelle requête.

### #2 candidat : `s2-combo-skill-driven`
- **Pourquoi** : empile Glicko + half-life 60d + WR-heavy (60-70%) + step-up
  penalty 0.35. Le diagnostic Phase 3 montrait que les 10 pires erreurs V2
  étaient toutes dues à un rating Glicko avec RD > 150 (faible info). Le
  WR-heavy filtre ces cas en privilégiant la baseline statistique.
- **Risque** : sur dataset sparse (n=45 originalement), Glicko a sous-performé.
  Doit être re-confirmé sur le snapshot complet (~200 matchs).

### #3 candidat : `s2-anti-farm`
- **Pourquoi** : SOS scale 1.5 + opp strength stretch (a=0.3 b=1.4). Cible
  spécifiquement le cas MarineLord 1.58 — un favori dont le WR vient surtout
  de victoires contre des sub-50% players.
- **Métrique attendue** : pas mieux globalement, mais **meilleur sur le
  10ème percentile des plus mauvaises prédictions** (les "favoris floppés").

## Score exact Monte Carlo — verdict attendu

L'implémentation MC + analytique vivent dans `services/odds/exactScore.ts`.
Avec un `pPerGame` iid (cas actuel sans data per-map), la MC est mathématiquement
équivalente au closed-form binomial — c'est juste une estimation bruitée à
~10k samples. Les 10 tests confirment la convergence (≤ 1 % d'écart à 50k sims).

**Recommandation prod** : utiliser `analyticalExactScore` (zéro variance, pas
de PRNG, ~100× plus rapide). La MC devient utile UNIQUEMENT quand le pipeline
data civ × map sera en place (option `perMapProb`).

Le variant v36 lance les deux côte à côte sur le snapshot pour produire
`audit/ODDS_EXACT_SCORE_2026-05-02.md`. À exécuter une fois snapshot pris.

## Optim egress — avant / après estimé

Voir `audit/EGRESS_AUDIT_2026-05-02.md` pour le détail.

| Source | Avant (GB/mois) | Après (GB/mois) | Économie |
|--------|------------------|-----------------|----------|
| `recalcActiveMatchOdds` PMR opp loop | 3-15 | 0.5-2 | **~5-13 GB** |
| `recalcActiveMatchOdds` p1+p2 PMR | 3-7 | 0.3-1 | **~3-6 GB** |
| `closeBetsPreMatch` | 0.1 | 0.001 | 100 MB |
| `distributePayouts` | 0.07 | 0.005 | 65 MB |
| `tickMatchStatuses` staleMatches | 0.005 | 0.001 | 4 MB |
| `GET /matches/:id` (UPCOMING/LIVE) | dépend trafic | -90 % | trafic-dépendant |
| `GET /matches/:id/h2h` | dépend trafic | -95 % | trafic-dépendant |
| **Total backend cron** | **~30-50 GB** | **~10-20 GB** | **~50-60 %** |

Suffisant pour repasser **sous le quota 5 GB/mois Supabase free-tier ?**
Probablement pas seul (backend cron ≈ 10 GB/mois après optim, hors HTTP
trafic user). Faut **soit** :
- Up Supabase Pro ($25/mois, 250 GB egress) — la solution la plus simple.
- **Soit** ajouter la materialized view `mv_player_records_summary` (économie
  estimée +3-5 GB/mois) — c'est la prochaine étape #5 ci-dessous.

## Bugs prod fixés (commits master, AVANT la branche)

| Commit | Bug | Fix |
|--------|-----|-----|
| `5b1843c` | #1 WTL filter rate "Team Vitality vs Onimaru Esports" | Restored `/i` flag sur teamPattern dans liquipediaScraper.ts. Cleanup script `cleanup-team-players.ts` à run quand DB ↑. |
| `01130ba` | #2 React #425 hydration sur /roulette | Mounted-gate wrapper sur RoulettePage. |
| `01130ba` | #3 CSP block Cloudflare Insights | Added `static.cloudflareinsights.com` à script-src + `cloudflareinsights.com` à connect-src. |

## Blockers rencontrés

1. **Supabase DB injoignable toute la nuit** (timeout, IPv6 only resolves).
   Probablement déjà passée en read-only / paused suite au egress overshoot.
   Bloque Phases 2, 3, 6, et la run du cleanup-team-players.
2. **`npm install` frontend KO** (bug `arborist` Cannot read properties of null)
   — pas critique, prod build sur Vercel/Railway fonctionne. À reproduire
   et reporter à npm si reproductible avec `npm@11.11.1` + node 25.8.2.
3. **PMR schema sans civ/map** — bloque les variants Phase 4 "civ matchup"
   et "map preference" demandés par le user. Need pipeline Liquipedia pour
   parser les BO games individuellement.

## Top 5 actions recommandées au réveil (priorisées)

1. **Réveiller la DB Supabase** (https://supabase.com/dashboard/project/xhusoizxbjkybcafvuss).
   Puis lancer en parallèle dans 2 terminaux différents :
   ```bash
   cd backend && npx tsx scripts/cleanup-team-players.ts          # dry-run
   # → si la liste a du sens, re-run avec --apply
   cd backend && npx tsx scripts/cleanup-team-players.ts --apply

   cd backend && npx tsx scripts/odds-experiments/snapshot-data.ts
   ```
   Attention : `cleanup-team-players.ts` peut faire des refunds — review la
   liste sortie en dry-run AVANT --apply.

2. **Run le backtest complet 35 variants + le v36 score exact**, puis review
   le leaderboard :
   ```bash
   cd backend
   npx tsx scripts/odds-experiments/run-all.ts                                    # 35 variants
   npx tsx scripts/odds-experiments/variants/v36_exact_score_montecarlo.ts        # exact-score
   ```
   Sortie : `audit/ODDS_LEADERBOARD_2026-05-02.md` + `audit/ODDS_EXACT_SCORE_2026-05-02.md`.
   Recommandation : si une variant `s2-*` bat le baseline de ≥ 0.01 Brier
   ET ≥ 1 pp accuracy, ouvrir une PR pour activer ses paramètres dans
   `oddsEngine.ts` derrière un nouveau flag.

3. **Décider sur Supabase Pro ($25/mois)** ou attendre l'effet des optims
   egress de cette nuit. Si on reste free-tier, ajouter la mat view
   `mv_player_records_summary` (snippet en pied du EGRESS_AUDIT). Mes
   estimations disent qu'on passe de 30-50 GB/mois à 10-20 GB — encore
   au-dessus du 5 GB free-tier. Pro est probablement la voie.

4. **Push la branche `odds-overnight-2026-05-02` ou la merger**. Les commits
   sont indépendants et chacun ship-able : (a) egress optim peut aller en
   prod tout de suite, (b) variants + score exact n'ont aucun effet runtime
   tant qu'ils ne sont pas câblés.

5. **Décider du data-pipeline civ × map**. C'est ce qui débloque les
   variants Phase 4 demandés (civ matchup + map preference) ET la vraie
   utilité du Monte Carlo exact-score (option `perMapProb`). Plan :
   - Étendre `PlayerMatchRecord` avec colonnes `civ` (string) et `map` (string)
     nullable + `gameNumber` (smallint) pour les BO multi-game.
   - Au lieu d'un row par match (BO), un row par game dans le BO.
   - Extender `liquipediaScraper.ts` pour parser le `{{Map|...}}` et
     `{{Civ|...}}` dans le wikitext de chaque game.
   - Effort estimé : ~4-6h (schema + migration + scraper + backfill).

## Annexes

- `audit/EGRESS_AUDIT_2026-05-02.md` — top 10 requêtes coûteuses, fixes
  implémentés, suggestions futures (mat view, throttle WS, index check).
- `backend/src/services/pmrCache.ts` — cache LRU-light TTL 5 min.
- `backend/src/services/odds/exactScore.ts` — MC simulator + 10 tests.
- `backend/scripts/odds-experiments/variants.ts` — 35 variants au total.
- `backend/scripts/cleanup-team-players.ts` — remediation Bug #1 (Bug WTL).

---

## Phase 2/3/6/6.5 Resumed — DB Restored 2026-05-02 morning

User upgraded Supabase to Pro and asked to resume the blocked phases.
Pro quota debloqué (250 GB/mois) mais le **vrai blocker était le réseau**,
pas le quota : `db.xhusoizxbjkybcafvuss.supabase.co` n'a qu'un AAAA record
(IPv6) et le devbox est IPv4-only. Solution : pooler Supavisor IPv4
`aws-1-eu-central-1.pooler.supabase.com:6543` avec
`?pgbouncer=true&connection_limit=1`. Cf `audit/SUPABASE_STATUS.md` pour
le détail + recommandation pour la `.env` perso.

### ✅ Phases complétées (timeline)

| Phase | Status | Output | Commit |
|-------|--------|--------|--------|
| 2 — snapshot data | ✅ 13.4 s, ~6 MB egress | `.snapshot.json` (3.9 MB, 24726 PMR + 172 matches) | gitignored |
| 3 — baseline 21 originals | ✅ | `audit/ODDS_BASELINE_2026-05-02.md` | included in next commit |
| 6 — full 36 variants + ROI | ✅ | `audit/ODDS_RESULTS_FULL_2026-05-02.md` + `audit/ODDS_VARIANTS_2026-05-02.json` | next commit |
| 6 — exact-score v36 | ✅ | `audit/ODDS_EXACT_SCORE_2026-05-01.md` | next commit |
| 6.5 — exact-score calibration | ✅ ECE 0.019 | `audit/EXACT_SCORE_VALIDATION.md` | next commit |
| 7 — cleanup dry-run | ✅ | `audit/CLEANUP_TEAM_PLAYERS_DRY_RUN.md` (6 offenders, 0 live) | next commit |

### 📊 Top 3 variants recommandés (dataset N=153 valides, baseline Brier 0.2061)

1. **`s2-combo-h2h-priority`** — Brier **0.1909** (Δ -0.0152), Acc 72.5% (Δ +0.7), ECE 0.1951.
   - Override : `h2hWeightScale: 0.50, h2hConfidenceMaxAt: 6, formWeight: 0.20`.
   - Pourquoi : H2H direct entre les deux joueurs prend plus de poids quand on a au moins ~6 confrontations passées (vs 12 par défaut). Réduit l'influence du form-factor à 20 %.
   - **C'est le winner unique qui bat le baseline simultanément sur Brier (-0.0152), Accuracy (+0.7 pp) et ECE (-0.0171).**

2. **`form-weight-0`** — Brier 0.1960 (Δ -0.0101), Acc 71.2%, ECE 0.1997.
   - Override : `formWeight: 0` — désactive complètement le facteur form.
   - Signal : le form-factor actuel ajoute du **bruit** sur ce dataset, pas du signal. À investiguer (overfit ? trop sensible aux 1-1 BO2 ?).

3. **`s2-no-form-no-streak`** — Brier 0.2004 (Δ -0.0057), Acc 69.9%, ECE 0.2041.
   - Override : `formWeight: 0, tierCtxWeight: 0.20`.
   - Confirme #2 + ajoute du poids au tier-context. Légèrement moins bon que pure-no-form.

**Bonus — par accuracy seule** : `s2-prior-weak` (75.2 %) — prior bayésien faible (1 pseudo-match au lieu de 5). Trade-off : Brier équivalent au baseline mais accuracy supérieure. Bon candidat si on optimise pour le top-pick rather que pour la calibration.

### 🎯 Score exact — verdict

- 143 prédictions BO3+BO5+BO7, ECE total **0.0193** (analytical).
- Monte Carlo (10k sims) ECE 0.0192 — strictement équivalent au closed-form analytical.
- **Recommandation prod** : utiliser `analyticalExactScore` (zéro variance, ~100× plus rapide). MC reste utile uniquement quand on aura le pipeline data per-game (civ × map → option `perMapProb`).
- Calibration excellente (< 0.05 = très bonne) sur tous les buckets sauf [80-100%] où il y a peu d'observations.

### 💰 Egress consommé cette session

**Total ≈ 6 MB** sur le quota Pro 250 GB/mois (= 0.0024 %). Décomposition dans `audit/EGRESS_TRACKING.md`.

Snapshot pris une fois, réutilisé par 5 scripts différents (run-all baseline, run-all 36 variants, v36 exact-score MC, calibration, cleanup dry-run). Pattern visé par les contraintes egress du prompt = ✅.

### 🚨 Anomalies détectées pendant les runs

1. **3 variants Glicko sont catastrophiques sur ce dataset** : `glicko-on` (Brier 0.2385), `glicko-plus-v2` (0.2358), `s2-combo-skill-driven` (0.2415). Ils dégradent le baseline de +3 à +4 pp Brier, et leur ROI est négatif (-8 à -13 % par bet). **Confirme la conclusion Phase 3/4 antérieure** : Glicko vanilla ne marche pas sur dataset sparse AoE — le rating est faux pour les joueurs avec RD > 150. Garder le flag `ODDS_ENGINE_V2_ENABLED=false` en prod.

2. **`form-weight-0` bat le baseline** — surprenant. Le form factor actuel (computeFormFactor avec dominance × tier × decay) ajoute du bruit, pas du signal. Hypothèse : la draw-handling (1-1 BO2) compte pour 0.5 dans le score moyen, ce qui peut sous- ou sur-estimer un joueur selon le pattern de ses derniers matchs. À investiguer dans une session future.

3. **6 player rows orphelins** matchent le team-pattern (Team Vitality, Onimaru Esports, Uxmal Esports, Rulers of Rome B, Team Venon Esports, Old School B). Aucun match LIVE/UPCOMING affecté. Le fix `5b1843c` (commit master) bloque les futurs ingest. Le cleanup actif n'est pas urgent — voir `CLEANUP_TEAM_PLAYERS_DRY_RUN.md`.

4. **Schema field rename** dans `cleanup-team-players.ts` : j'avais référencé `matchesAsP1`/`P2` au lieu de `matchesAsPlayer1`/`Player2`. Corrigé pendant la run, à committer.

### 📋 Top 3 actions recommandées pour merge en prod (avec ordre + risques)

#### Action 1 (faible risque, gros gain immédiat) — Merger les optims egress
- Commit `05516e5` (cache PMR + select-only fixes).
- **Risque** : minime. Tous les call sites sont des reads en cron. Le cache TTL est volontairement sous-conservatif (5 min) — les odds tournent toutes les 10 min de toute façon.
- **Gain estimé** : -50 à -60 % egress backend, ce qui rend le coût Pro acceptable si tu décides plus tard de descendre vers Free / Team plan.
- **Test plan** : déployer + monitorer le egress Supabase pendant 24 h. Si la DB tient sans erreur de connexion, c'est OK.

#### Action 2 (risque modéré, gain odds) — Pousser `s2-combo-h2h-priority` derrière flag
- Modif `oddsEngine.ts` : changer `h2hWeightScale` de 0.30 → 0.50 et `h2hConfidenceMaxAt` de 12 → 6, `formWeight` de 0.30 → 0.20, derrière un nouveau flag `ODDS_ENGINE_H2H_PRIORITY=true`.
- **Risque** : Brier amélioré sur backtest mais N=153 reste petit. Possibilité d'overfit.
- **Test plan** : activer le flag sur prod, comparer le Brier live des 50 prochains matchs vs prod actuelle (côte à côte via le cron weekly backtest).
- **Rollback** : 1 ligne d'env var sur Railway.

#### Action 3 (risque très faible, fin du backlog) — Merger Bug #4 ledger sur prod
- Commit `4f83837` (déjà sur master local, attend ton review final).
- **Risque** : minime, juste des INSERT supplémentaires dans Transaction. Les `$transaction` blocks sont déjà en place donc pas de race condition introduite.
- **Test plan** : déployer + vérifier que la requête Q2 du Phase B SQL audit (drift balance vs ledger) commence à se rapprocher de zéro pour les nouveaux users post-deploy.

#### Hors top-3 (à mettre en backlog pour une session future) :
- Pipeline data civ × map per game → débloque les variants Phase 4 originaux + l'option `perMapProb` du score exact MC.
- Investiguer pourquoi `form-weight-0` bat le baseline — soit améliorer la formule, soit la retirer pour de bon.
- Switch `DATABASE_URL` vers le pooler dans `.env` pour les devs, ou ajouter une note README.


