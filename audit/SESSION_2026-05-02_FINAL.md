# Session 2026-05-02 — Final report

Recap d'une journée de travail divisée en 4 sessions enchaînées :
1. Overnight #1 (01:10-04:30 — branche null, blocage DB)
2. Overnight #2 (04:30-07:00 — branche `odds-overnight-2026-05-02`, 4 commits)
3. DB-restored backtest run (matin — 4 commits supplémentaires)
4. **Cette session : Push + Merge + Phase D nouveaux variants** (4 commits)

## Section 1 — Merge & Deploy

### ✅ Branche mergée sur master
- Merge commit : `eb88099` — `merge: odds-overnight-2026-05-02`
- Tag : `v-odds-overnight-2` (poussé sur GitHub)
- Branche aussi poussée : `odds-overnight-2026-05-02` (préservée)

### ✅ Tests passés
- Backend `tsc --noEmit` : clean
- 10/10 unit tests passent (`npx tsx --test src/services/odds/__tests__/exactScore.test.ts`)
- Frontend `tsc --noEmit` : clean (toutes les corrections de la nuit 1 tiennent)
- Pas de `npm test` script côté backend (jamais configuré) — tests via node:test runner

### ✅ Bloqueurs rencontrés (et résolus)
- **DB injoignable IPv6-only** : direct host `db.<ref>.supabase.co` résout uniquement en AAAA. Fix : pooler IPv4 `aws-1-eu-central-1.pooler.supabase.com:6543` avec `?pgbouncer=true&connection_limit=1`. Documenté `audit/SUPABASE_STATUS.md`.
- **Schema rename PMR** : `cleanup-team-players.ts` référençait `matchesAsP1` au lieu de `matchesAsPlayer1`. Corrigé.

### Variables d'env Railway/Vercel à configurer

**À configurer immédiatement (release v-odds-overnight-2)** : aucune. Les nouveaux flags ont default OFF, déploiement behavior-preserving.

**Optionnel (à activer après 24-48 h monitoring)** :

| Service | Var | Recommandation |
|---------|-----|----------------|
| Railway backend | `ODDS_ENGINE_BAYES_WEAK_H2H` | Set to `true` après comparaison live via le cron weekly backtest. **Variant gagnant absolu**. |
| Railway backend | `ODDS_ENGINE_H2H_PRIORITY` | NE PAS toucher si BAYES_WEAK_H2H est on (impliqué). Sinon set à `true` pour le variant intermédiaire. |
| Vercel frontend | _(rien)_ | aucun changement frontend |

**Déjà configurées en prod, ne pas toucher** :
- `ODDS_ENGINE_V2_ENABLED` = false (Phase 3/4 confirme V2 worse)
- `ODDS_ENGINE_EXACT_V2_ENABLED` = true (live depuis avril)

## Section 2 — Nouveaux variants explorés (Phase D)

### Tableau comparatif essentiel (baseline + winner sessions 1/2/3 + 5 plus performants v37-v46)

| Variant | Source | Brier ↓ | LogLoss ↓ | ECE ↓ | Acc ↑ | ROI/bet | Δ Brier baseline |
|---------|--------|---------|-----------|-------|-------|---------|-----------------:|
| `baseline` | prod V1 | 0.2061 | 0.6007 | 0.2121 | 71.9% | 0.105 | — |
| `s2-combo-h2h-priority` | session 2 winner | 0.1909 | 0.5670 | 0.1951 | 72.5% | 0.060 | -0.0152 |
| **`v45-bayes-weak-h2h`** | **session 3 NEW WINNER** | **0.1897** | **0.5645** | **0.1932** | **73.2%** | 0.063 | **-0.0164** |
| `v40-anti-farm-h2h` | session 3 — null result | 0.1909 | 0.5670 | 0.1951 | 72.5% | 0.060 | -0.0152 |
| `v44-combo-h2h-tier-streak` | session 3 — partial | 0.1959 | 0.5779 | 0.2018 | 71.9% | 0.058 | -0.0102 |
| `v43-format-match-boost` | session 3 — partial | 0.2012 | 0.5902 | 0.2110 | **75.8%** | 0.163 | -0.0049 |
| `v37-tier-context-boost` | session 3 — abandoned | 0.2124 | 0.6139 | 0.2160 | 69.3% | 0.059 | +0.0063 |
| `v46-ensemble (top-5)` | orchestrator | 0.1921 | 0.5700 | 0.1977 | 73.2% | n/a | -0.0140 |

### Top 3 résultats Phase D

#### 🥇 #1 — `v45-bayes-weak-h2h`
- **Hypothèse validée** : combiner les overrides h2h-priority avec un prior bayésien faible (1 vs 5) garde le meilleur des deux mondes (Acc de prior-weak + Brier de h2h-priority).
- **Métriques** : Brier 0.1897 (-0.0164), Acc 73.2 % (+1.3 pp), ECE 0.1932 (-0.0190).
- **Action** : déjà câblé derrière `ODDS_ENGINE_BAYES_WEAK_H2H` (default OFF).

#### 🥈 #2 — `v40-anti-farm-h2h` (null result précieux)
- **Hypothèse invalidée** : ajouter SOS / opp-strength stretch sur l'override h2h-priority **ne change rien**. Métriques byte-identiques à `s2-combo-h2h-priority`.
- **Cause** : la SOS feature ne déclenche presque jamais (faille `sosMinMatches=5` rarement atteinte).
- **Action** : drop la branche SOS du moteur OU baisse `sosMinMatches` à 2-3.

#### 🥉 #3 — `v43-format-match-boost`
- **Hypothèse partiellement validée** : booster les records du même format que le match courant (BO3 vs BO5) donne **la meilleure accuracy de tout le field (75.8 %)**, mais Brier reste mediocre (0.2012). Symptôme d'overconfidence.
- **Action** : passer une calibration isotonique post-hoc avant de promouvoir. Worth investigating.

### Variants à promouvoir en feature flag
1. **`v45-bayes-weak-h2h`** — déjà fait (`ODDS_ENGINE_BAYES_WEAK_H2H`).

### Variants à abandonner (résultats franchement négatifs)
- `v37-tier-context-boost` : tier-context ↑ hurts. Drop.
- `glicko-on`, `glicko-plus-v2`, `s2-combo-skill-driven` : Glicko cassé sur sparse data. Re-tester si N > 500.

### Variants à laisser dormants (null results, pas de signal)
- `v38-streak-decay-aggressive`
- `v39-opp-strength-extreme`
- `v41-patch-reset-2026-04`
- `v42-consistency-shrink`

Ces variants restent dans le harness comme **signal négatif** documenté.

## Section 3 — Roadmap odds engine

### Top 5 features prioritaires (par ROI estimé)

| # | Feature | Effort | Gain attendu | Pourquoi |
|---|---------|--------|--------------|----------|
| 1 | **Civ × map data ingest** | 4-6 h | unknown — gros potentiel | `BoResult` schema existe avec `p1Civ`/`p2Civ`/`map` mais 0 row populé. Débloque civ matchup, map preference, et l'option `perMapProb` du Monte Carlo exact-score. Effort = scraper Liquipedia per-game wikitext OU aoe4world.com replay parse. |
| 2 | **Investigate form factor noise** | 1-2 h | -0.005 à -0.01 Brier | `form-weight-0` bat baseline de -0.0101. Soit fix `computeFormFactor`, soit downweight permanent. À investiguer : draw handling 1-1 (BO2) ou la dominance bonus 3-0/4-0. |
| 3 | **Larger sample window** | passive | tighter error bars partout | À N=153 chaque Brier delta < 0.005 est dans le bruit. Attendre N > 250 (~1 mois de tournois) avant de promouvoir d'autres variants. |
| 4 | **Calibrer `v43-format-match-boost`** | 1 h | -0.005 Brier (peut-être) | Acc 75.8 % (best in field) mais Brier 0.2012 — overconfident. Isotonic regression post-hoc sur la prob format-boostée. |
| 5 | **Real Microsoft patch dates** | 1 h | -0.005 Brier par patch significatif | `v41-patch-reset` fail parce que la date était devinée. Si on hardcode les vraies dates des patches AoE4 (et qu'il y a eu ≥ 1 meta shift dans le dataset), gain réel. |

### Pipeline data civ × map (effort ~4-6 h documenté)

Steps :
1. **Schema** : aucun changement — `BoResult.p1Civ`/`p2Civ`/`map` existent.
2. **Scraper** : extension de `liquipediaScraper.ts` ou `liquipediaLiveScorer.ts`
   pour parser le wikitext per-game `{{Map|<name>}}` et `{{Civ|<id>}}`.
3. **Backfill** : script one-shot pour scraper les 172 matches COMPLETED
   existants. Estimer 30-60 min de scraping (avec rate-limit LP).
4. **PMR extension** : OPTIONNEL — ajouter `civ`/`map`/`gameNumber` à PMR pour
   simplifier les jointures côté odds engine. Non requis si on join directement
   `Match.boResults`.
5. **Variant** : `v50-civ-matchup-matrix` qui apprend une matrice C×C de
   matchup advantages depuis l'historique BoResult, et la blend dans l'odds.
6. **Score exact** : passer `perMapProb` à `simulateExactScore` calculé
   depuis la liste des maps confirmed pour le tournoi.

### Investigations en suspens

- **Form factor donne du bruit** — pourquoi exactement ? Hypothèses :
  - draw handling (1-1 BO2 compte 0.5) sur-corrige
  - dominance bonus (3-0 vaut 1.6×) sur-pondère les sweeps
  - tier multiplier (S=2.5 vs B=1) trop écrasant en low-data
- **SOS dead** — `sosMinMatches=5` rarement atteint. Fix : abaisser à 2.
- **Glicko sparse** — RD > 150 trop fréquent. Fix : forcer un floor RD < 100
  avant le N-ième match, ou abandonner Glicko jusqu'à ce que dataset > 500.

## Section 4 — Decisions attendues de Matteo

Liste numérotée. Pour chaque : option A/B/C + recommandation + urgence.

### Decision 1 — Activer `ODDS_ENGINE_BAYES_WEAK_H2H` en prod ?
- **A** : Activer maintenant via Railway env var.
- **B** : Activer après 24-48 h de monitoring side-by-side via weekly backtest cron.
- **C** : Attendre dataset N > 250 (~1 mois) avant tout switch.
- **Recommandation** : **B**. Le backtest est solide (-0.0164 Brier sur 3 métriques) mais N=153 reste petit. Le monitoring 24-48 h donne un signal live avant de switcher tous les utilisateurs.
- **Urgence** : week (pas semaine prochaine, mais pas immediate).

### Decision 2 — Déclencher `cleanup-team-players.ts --apply` ?
- **A** : Oui, supprimer les 6 joueurs orphelins (Team Vitality / Onimaru Esports / etc).
- **B** : Non, laisser dormants (0 match LIVE/UPCOMING affecté).
- **Recommandation** : **B**. Le fix `5b1843c` bloque les futurs ingest. Les 6 orphelins n'apparaissent nulle part user-visible. Risk d'effets secondaires (FK cascade) > gain.
- **Urgence** : month (jamais critique).

### Decision 3 — Lancer le data ingest civ × map ?
- **A** : Maintenant, c'est la feature à plus gros ROI potentiel.
- **B** : Après avoir épuisé les autres optims (form factor noise, format-boost calibration).
- **C** : Jamais, focus produit ailleurs.
- **Recommandation** : **A**. C'est le seul gros levier non exploité dans le data layer. Le reste des optims marche au µm.
- **Urgence** : week.

### Decision 4 — Drop la SOS branch du moteur ?
- **A** : Drop complètement, simplifier `oddsEngine.ts`.
- **B** : Garder mais baisser `sosMinMatches` de 5 à 2 pour qu'elle déclenche.
- **C** : Laisser tel quel (dead code mais pas nuisible).
- **Recommandation** : **B**. La feature est probablement bonne en théorie, juste mal calibrée.
- **Urgence** : month.

### Decision 5 — Investiguer le form factor noise ?
- **A** : Oui, ouvrir un ticket "form factor ablation study".
- **B** : Non, juste downweight `formWeight` à 0.20 par défaut (en dehors du flag).
- **Recommandation** : **A** d'abord, **B** comme fallback si A pas conclusif. C'est -0.01 Brier laissé sur la table.
- **Urgence** : week.

## Annexes

### Fichiers générés cette session

```
audit/SESSION_2026-05-02_FINAL.md           ← ce fichier
audit/SUPABASE_STATUS.md                     pooler IPv4 fix
audit/EGRESS_TRACKING.md                     ~6 MB consumé
audit/EGRESS_AUDIT_2026-05-02.md             top 10 sinks + remediation
audit/MERGE_SUMMARY.md                       diff master vs branch + risks
audit/UNUSED_FEATURES.md                     features DB pas utilisées
audit/ODDS_BASELINE_2026-05-02.md            21 originaux leaderboard
audit/ODDS_RESULTS_FULL_2026-05-02.md        36 variants ROI table
audit/ODDS_RESULTS_V37_V46_2026-05-02.md     46 variants ROI table (final)
audit/ODDS_V46_ENSEMBLE_2026-05-01.md        ensemble verdict
audit/ODDS_EXACT_SCORE_2026-05-01.md         MC vs analytical
audit/EXACT_SCORE_VALIDATION.md              ECE 0.019 calibration
audit/CLEANUP_TEAM_PLAYERS_DRY_RUN.md        6 offenders, 0 live
audit/PR_DESCRIPTION.md                      ready-to-paste merge summary
audit/OVERNIGHT_REPORT_2_2026-05-02.md       overnight 2 report
docs/DEPLOY_NOTES_2026-05-02.md              v-odds-overnight-2 release notes
docs/ODDS_ENGINE.md                          living doc — every variant ever
```

### Commits cette session (tous sur master, poussés)

```
22944f5 feat(odds): v37-v46 variants + new winner v45-bayes-weak-h2h flag
34453a2 docs(deploy): notes for v-odds-overnight-2 release
eb88099 (tag: v-odds-overnight-2) merge: odds-overnight-2026-05-02
cec0109 docs(merge): MERGE_SUMMARY.md for odds-overnight-2 branch
803872c chore(env): document pooler URL + odds engine flags in .env.example
d9e4bb7 feat(odds): feature flag ODDS_ENGINE_H2H_PRIORITY for s2-combo-h2h-priority winner
0d26551 docs(odds-overnight-2): backtest results + analyzers + PR description
48adb00 docs(overnight2): final report for night 2 — egress + odds + score exact
0617461 feat(odds): 15 new tunable variants + exact-score Monte Carlo (Phases 4+5)
05516e5 feat(egress): cache PMR + select-only fixes for top 5 cron sinks
```

### Egress consumé total cette session

| Phase | Egress (MB) |
|-------|-------------|
| Snapshot #1 (overnight 2 morning) | ~6 |
| Re-snapshot avec format field | ~6 |
| Cleanup dry-run | <0.05 |
| Smoke tests / counts | <0.5 |
| **Total** | **~12-13 MB** sur quota Pro 250 GB/mois (= 0.005 %) |

Pattern visé respecté : snapshot une fois par jour, replay infini en local.
