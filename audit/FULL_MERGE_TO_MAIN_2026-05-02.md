# Full merge to prod — 2026-05-02

## Heure du merge final

Merge commit timestamp : **2026-05-02 06:56 (local) / 21:56 UTC**.

## ⚠️ Note sur "main" vs "master"

Le prompt demandait d'utiliser `main` comme branche prod. **La branche prod
de ce repo est `master`** (origin/HEAD pointe sur origin/master, pas de
branche `main` ni locale ni remote). Pour ne pas casser :
- les hooks Railway auto-deploy (configurés sur master),
- les références GitHub (default branch, PRs, etc.),
- les workflows CI éventuels,

j'ai exécuté l'intention (push tout le travail sur la branche prod) sur
`master` au lieu de renommer `master` → `main`. Si tu veux faire le rename
plus tard, c'est faisable mais nécessite une coordination Railway + GitHub.

## Branches mergées

| Branche source | Commits ahead avant merge | Status |
|----------------|---------------------------|--------|
| `prod-bugs-fix-2026-05-02` | 4 commits | ✅ mergée via merge commit `d888602` |
| `odds-overnight-2026-05-02` | 0 commits | déjà mergée plus tôt (commit `eb88099`) — no-op cette fois |
| `dev` | 0 commits | rien à merger |

Donc **un seul merge effectif** ce coup-ci : `prod-bugs-fix-2026-05-02` →
`master` via `d888602`.

## Liste de TOUS les commits maintenant sur master (15 derniers)

```
d888602  merge: prod-bugs-fix-2026-05-02 (LP breaker + aoe4world stats + P2002 + avatar)
18a93b6  docs: PROD_BUGS_FIX_2026-05-02.md — full report on 4 production bugs fixed
f239359  test(liquipedia): cover P2002-on-name fallback for Player upsert (Bug #3)
e1d0bdd  fix(enrich): aoe4world stats — categorized failure logging + alert at <50% success
8e1678c  fix(liquipedia): auto-unblock breaker probe + exponential backoff + avatar deferral
a707ffd  docs: SESSION_2026-05-02_FINAL.md — full session report
22944f5  feat(odds): v37-v46 variants + new winner v45-bayes-weak-h2h flag
34453a2  docs(deploy): notes for v-odds-overnight-2 release
eb88099  merge: odds-overnight-2026-05-02
cec0109  docs(merge): MERGE_SUMMARY.md for odds-overnight-2 branch
803872c  chore(env): document pooler URL + odds engine flags in .env.example
d9e4bb7  feat(odds): feature flag ODDS_ENGINE_H2H_PRIORITY for s2-combo-h2h-priority winner
0d26551  docs(odds-overnight-2): backtest results + analyzers + PR description
48adb00  docs(overnight2): final report for night 2 — egress + odds + score exact
0617461  feat(odds): 15 new tunable variants + exact-score Monte Carlo (Phases 4+5)
```

## Tags

| Tag | Pointe sur | Use |
|-----|------------|-----|
| `backup-pre-fullmerge-20260502-0656` | `a707ffd` (état master pré-merge) | **rollback ultime** — ramène master à l'avant-merge si tout pète |
| `v-odds-overnight-2` | `eb88099` (merge précédent) | release marker odds + score exact (créé en début de soirée) |
| `v-prod-bugs-fix` | `d888602` (merge prod-bugs-fix) | release marker pour les 4 bugs prod fixés |

Tous pushés sur origin.

## Commande de rollback en cas de problème

### Option 1 — Revert le dernier merge seulement (préserve le reste, recommandé)
```bash
git revert -m 1 d888602
git push origin master
```

### Option 2 — Rollback complet vers le tag backup
```bash
# DESTRUCTIF — ne fais ça que si Railway est en boucle de crash
git checkout master
git reset --hard backup-pre-fullmerge-20260502-0656
git push --force-with-lease origin master
```
Préfère **Option 1** dans 99 % des cas (force-push sur master = casse les
clones de tous les contributeurs + casse Railway si le rev historique est
référencé quelque part).

## Feature flags présents (DOIVENT rester false par défaut sur Railway)

| Flag | Default code | Recommandation |
|------|--------------|----------------|
| `ODDS_ENGINE_V2_ENABLED` | false | Laisse OFF — Phase 3/4 backtests confirmés worse |
| `ODDS_ENGINE_H2H_PRIORITY` | false | Laisse OFF pour l'instant — variant validé par backtest mais pas par live monitoring |
| `ODDS_ENGINE_BAYES_WEAK_H2H` | false | Laisse OFF pour l'instant — winner Phase D, à activer après 24-48 h de monitoring |
| `ODDS_ENGINE_EXACT_V2_ENABLED` | true (déjà set) | NE PAS toucher — déjà ACTIVE en prod depuis 2026-04-19 |

**Action concrète** : connecte-toi à Railway → Variables → vérifie qu'aucun
de ces flags n'est passé à `true` par accident pendant la soirée. Tous
default-OFF dans le code, donc si la var n'existe pas dans Railway, c'est OK.

## Variables d'env à vérifier sur Railway

| Var | Valeur attendue |
|-----|-----------------|
| `DATABASE_URL` | doit fonctionner depuis Railway. Note : depuis le devbox local, la direct URL `db.<ref>.supabase.co:5432` ne marche QUE en IPv6. Railway IPv6 OK donc tu peux garder la direct URL, OU passer au pooler `aws-1-eu-central-1.pooler.supabase.com:6543?pgbouncer=true&connection_limit=1` (recommandé pour la cohérence devbox/prod). |
| `LP_WORKER_URL` | toujours nécessaire pour router les LP requests via Cloudflare Worker (sinon Railway IP se fait re-blacklister régulièrement) |
| `LP_WORKER_AUTH` | doit matcher la valeur configurée côté Worker |
| `TWOCAPTCHA_API_KEY` | nécessaire pour l'auto-unblock LP. Vérifie le solde 2captcha. |
| Autres flags existants | NE PAS TOUCHER |

## Checklist post-deploy (15-20 min après le push)

- [ ] Railway dashboard → backend service → "Deployments" → vérifier que le build passe
- [ ] `curl https://api.ageof.money/api/health` → 200 OK
- [ ] `curl https://api.ageof.money/api/v1/matches?limit=5` → real data
- [ ] Tail Railway logs : chercher `Initializing cron jobs` (boot OK)
- [ ] Chercher `[OddsEngine]` dans les logs — devrait être SILENT (aucun flag activé). Si tu vois `ODDS_ENGINE_H2H_PRIORITY active` ou `ODDS_ENGINE_BAYES_WEAK_H2H active`, c'est qu'un flag est par erreur à true sur Railway.
- [ ] Attendre la prochaine cron `enrichAllUpcomingMatches` (toutes les 30 min) et vérifier la nouvelle ligne :
      `Player stats update complete: X updated, Y errors [stats_api_failed=N, profile_unresolvable=M, ...]`
      — c'est la nouvelle observabilité Bug #2.
- [ ] Si tu vois des 429 dans les logs : vérifier que le breaker affiche maintenant `circuit breaker open for 5min` (était 2min avant le fix Bug #1).
- [ ] Bug #4 ledger (commit `4f83837` mergé il y a quelques heures) : vérifier
      que de nouvelles rows `Transaction` apparaissent quand un user place
      un pari / coinflip / etc.
      ```
      SELECT type, COUNT(*) FROM "Transaction"
      WHERE "createdAt" > NOW() - INTERVAL '1 hour'
      GROUP BY type;
      ```

## Branches à supprimer (optionnel, après validation 24 h)

Une fois que tu as confirmé que Railway tourne stable :
```bash
git push origin --delete prod-bugs-fix-2026-05-02
git push origin --delete odds-overnight-2026-05-02
git branch -d prod-bugs-fix-2026-05-02 odds-overnight-2026-05-02
```
À ne PAS faire avant validation — ces branches sont les "snapshots" du
travail au cas où le merge introduit un bug subtil qui n'apparaît qu'après
quelques heures.
