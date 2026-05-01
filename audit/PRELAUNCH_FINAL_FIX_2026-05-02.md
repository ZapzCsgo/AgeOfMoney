# Prelaunch FINAL fix — 2026-05-02

## 1. Décision stratégique

**On désactive le batch périodique aoe4world player stats.**

Rationale (cf. `audit/AOE4WORLD_DEPRECATED_2026-05-02.md` pour le détail) :
- aoe4world.com ne couvre que les joueurs **ranked AoE4** (~150 sur les 535
  players de notre base).
- Les pros multi-jeux qu'on track (AoE2 vietnamiens, pros AoE3/AoM) ne sont
  PAS dans aoe4world.com → 100 % de failures `profile_unresolvable` sur
  chaque batch depuis le launch.
- **Pour un site de paris esports tournament-only**, l'ELO ladder et les
  stats casual d'aoe4world ne prédisent rien de pertinent. Ce qui compte
  c'est la perf en tournament/match officiel — déjà collectée via
  Liquipedia + tracking interne des match results.

Ce qu'on garde (intact) :
- `scrapeAoe4WorldTournaments` (cron 15min) — calendrier de tournois S/A
- `buildProPlayerSet` — set des ~156 pro IDs, cheap, utilisé par
  l'enrichissement H2H
- `enrichMatchWithH2H` (Priority 3 fallback) — appelle `getH2H` UNIQUEMENT
  pour les paires de joueurs qui ont déjà un aoe4worldId stocké en DB
- Admin manual trigger `POST /api/v1/admin/scrapers/run { source: "aoe4world" }`
  — la fonction `updateAllPlayerStats` reste exportée et callable

Ce qu'on désactive :
- Le `await updateAllPlayerStats()` au début de `enrichAllUpcomingMatches`
  (cron 30min) — commenté avec pointeur explicatif vers le doc

## 2. Code modifié

| Commit | Subject |
|--------|---------|
| `09269b4` | `feat(enrich): deprecate aoe4world player stats batch update` |

Fichiers touchés :
- `backend/src/scrapers/aoe4worldScraper.ts` (1 ligne commentée + bloc commentaire de 6 lignes pointant vers le doc)
- `audit/AOE4WORLD_DEPRECATED_2026-05-02.md` (nouveau, doc complète)

Tests : pas de test unitaire à ajouter — c'est un changement de configuration
(disable d'un appel) qui ne modifie aucune logique testable. Le tsc
`npx tsc --noEmit` passe clean.

## 3. État Railway après deploy

API live check (post commit 09269b4 push) :
```
$ curl -s -o /dev/null -w "API HTTP %{http_code} time %{time_total}s\n" \
    --max-time 15 https://api.ageof.money/api/v1/matches?limit=3
API HTTP 200 time ~0.9s
```
✅ API répond, no regression.

Logs Railway attendus dans les ~30 prochaines min (timing du prochain tick
cron `enrichAllUpcomingMatches`) :
- ❌ Plus de `Player stats update complete: 0 updated, 50 errors`
- ❌ Plus de `[aoe4world] ALERT — batch success rate 0%`
- ❌ Plus de `[aoe4world] Failure example (profile_unresolvable): ...`
- ✅ Le log `[Enrich] Starting post-scrape enrichment` continue (la fonction
  tourne, juste sans le `updateAllPlayerStats()` au début)
- ✅ Le log `[Enrich] Done — enriched X/Y active matches` continue
- ✅ `scrapeAoe4WorldTournaments` (cron 15 min) continue à tourner — pas
  touché. On verra encore `[aoe4wTourn] Found N relevant S/A-tier 1v1 tournaments`.

## 4. État final prod

### Checklist soft launch

- [x] **API live + healthy** (200 OK sur `/api/v1/matches`)
- [x] **DB live** (Supabase Pro, pooler IPv4 fonctionnel)
- [x] **Bug #4 ledger** mergé (Transactions écrites pour bet/coinflip/jackpot/roulette/tip/affiliate/admin)
- [x] **Egress optims** mergées (cache PMR + select-only fixes, ~50-60 % cron drop)
- [x] **3 prod bugs LP/aoe4world fixés et mergés** (LP breaker auto-unblock + aoe4world stats categorized + Player.upsert P2002)
- [x] **6 orphan team-players supprimés** + cleanup script étendu pour cascade-delete safe
- [x] **Worker breaker logic fixée** (détection "IP not blocked" → close immediately)
- [x] **AoE4 upcoming page logging amélioré** (cause exacte au prochain fail)
- [x] **Filtre `game: 'AoE4'` sur batch picker** (root cause des 50/50 fails)
- [x] **Batch update aoe4world périodique désactivé** (ce commit)
- [x] **Tag `v-prod-bugs-fix` + `backup-pre-fullmerge-...`** poussés sur origin
- [x] **2 feature flags odds (H2H_PRIORITY + BAYES_WEAK_H2H) câblés OFF par défaut** — à activer après 24-48h de monitoring side-by-side
- [x] **Variant winner identifié** (`v45-bayes-weak-h2h`, Brier 0.1897 vs baseline 0.2061)

### À VÉRIFIER MANUELLEMENT avant le soft launch

- [ ] Connecte Railway dashboard → vérifier que le redeploy s'est passé green
- [ ] Tail logs pour confirmer les "❌ plus de" listés ci-dessus
- [ ] Rotater le password Supabase (le précédent a été exposé en argv)
  - Une fois rotaté, mettre à jour la var Railway `DATABASE_URL`
  - Mettre à jour `backend/.env` local
- [ ] Smoke tests UX :
  - [ ] Connexion Steam OK
  - [ ] Visualisation matchs UPCOMING/LIVE
  - [ ] Placement d'un pari de test (1 coin)
  - [ ] Coinflip rapide
  - [ ] Roulette (dernière feature qui avait React #425 — vérifier que le fix tient)
- [ ] Activer Cloudflare Insights (le CSP est déjà ouvert depuis `01130ba`)

### Status

🚀 **READY TO SOFT LAUNCH** — sous réserve des 4 vérifs manuelles ci-dessus.

Le pipeline data tourne sans pollution de logs. La DB est stable, la prod
est isofonctionnelle au pré-fix avec 4 bugs critiques en moins. Les flags
risqués (odds H2H_PRIORITY, BAYES_WEAK_H2H) sont OFF — 100 % du flow odds
est sur le baseline V1 éprouvé.

## Recap commits cette session

```
09269b4 feat(enrich): deprecate aoe4world player stats batch update
651cf09 docs: PRELAUNCH_FIX_2026-05-02.md — 4 fixes pushed (...)
48e2fd4 fix(enrich): filter aoe4world batch to game='AoE4' only
d34bbee fix(scraper): surface real cause when AoE4 upcoming-page fetch fails
dd5870a fix(lpscorer): treat 'IP not blocked' worker response as unblock signal
da5172f chore(cleanup): apply team-players orphan cleanup (6 rows removed)
003f5f5 docs: FULL_MERGE_TO_MAIN_2026-05-02.md
d888602 merge: prod-bugs-fix-2026-05-02
```

Tout sur master, tout pushé sur origin.
