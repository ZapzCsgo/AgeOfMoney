# Prelaunch fix — 2026-05-02

Triple fix avant soft launch Reddit/Twitter. 3 problèmes traités + 1 root
cause supplémentaire découverte en cours de route.

## 1. Cleanup team players orphelins (Problem 1)

**Status** : ✅ APPLIQUÉ.

- 6 player rows supprimées (Team Vitality, Onimaru Esports, Uxmal Esports, Rulers of Rome B, Team Venon Esports, Old School B)
- 5 historical CANCELLED matches supprimées
- 22 PlayerMatchRecord rows supprimées
- 0 match LIVE/UPCOMING affecté, 0 bet, 0 boResult
- Run via `cleanup-team-players.ts --apply --cascade-delete-orphans`
  (nouveau flag ajouté pour walker la chaîne FK Match → PMR → Player en
  refusant tout match avec data réelle)

**Heure** : 2026-05-02 22:09 UTC.

**Détail complet** : `audit/CLEANUP_APPLIED_2026-05-02.md`.

**Commit** : `da5172f` `chore(cleanup): apply team-players orphan cleanup (6 rows removed)` — pushé sur master.

## 2. Worker breaker — "IP not blocked" → close

**Status** : ✅ FIXÉ.

**Root cause** : le CF Worker `aom-lp-proxy.zapzonionzcsgo.workers.dev` surface la réponse plain-text "This IP address is not blocked." de Liquipedia avec un HTTP 400 (pas 200). Le code précédent traitait tous les 400 comme failure → breaker stuck open malgré que LP confirmait l'IP healthy → après 3 retries la "quiet mode" kickait → breaker stuck jusqu'à expiration naturelle.

**Fix** :
- Helper pur `isIpUnblockedSignal(body)` exporté pour testabilité.
- Détection du signal AVANT le branch 4xx-failure générique. Si match → log info + `resetCircuitBreaker()` + return success.
- Pas de re-vérification via `verifyLpAccess()` : si LP nous dit qu'on est unblock, on prend ça comme ground truth. Worst case = breaker se re-trip au prochain 429 réel. Strictement mieux que stuck.

**Tests** : 7/7 dans `src/services/__tests__/liquipediaLiveScorer.test.ts` — 5 existants + 2 nouveaux pour `isIpUnblockedSignal`.

**Commit** : `dd5870a` `fix(lpscorer): treat 'IP not blocked' worker response as unblock signal` — pushé sur master.

## 3. AoE4 upcoming page fail — observability

**Status** : ✅ FIXÉ (logging only — pas de bug fonctionnel détecté).

**Root cause hypothesis** : trois paths silencieux dans `fetchHtml` / `fetchViaMediaWikiApi` :
- `isLpBlocked()` → `null` avec `logger.debug` (invisible en prod)
- MediaWiki API empty body → `null` silent
- Direct fetch retry exhausted → `null` silent

**Fix (additif, aucun changement de comportement)** :
- Promotion de `debug` → `info` sur le breaker-skip log + remaining minutes
- Log warn quand MediaWiki API renvoie un body vide / une erreur API (`code` + `info`)
- Top-level call site append "(circuit breaker open — see prior log)" si `isLpBlocked()`

Au prochain "Failed to fetch AoE4 upcoming page", la cause exacte sera dans les logs.

**Commit** : `d34bbee` `fix(scraper): surface real cause when AoE4 upcoming-page fetch fails` — pushé sur master.

## 4. BONUS — Root cause des 50/50 failures aoe4world

**Status** : ✅ FIXÉ (découverte pendant l'investigation Problem 1).

Le cleanup ne représente que **6/50** des failures. Investigating le batch picker :
```ts
prisma.player.findMany({ select: { id, name }, orderBy: { lastUpdatedAt: 'asc' }, take: 50 })
```
**Pas de filtre `game`**. Le picker retournait des joueurs AoE2 (ex: Chim Sẻ Đi Nắng, Truy Mệnh — pros AoE2 vietnamiens) au top de la liste. aoe4world.com **n'a que des profils AoE4**, donc tous ces lookups ramenaient `null` → `profile_unresolvable`.

DB state : 535 players total, 150 avec aoe4worldId, 385 sans. Sur les 385 sans-ID, beaucoup sont non-AoE4 → empoisonnaient toutes les batches.

**Fix one-liner** : `where: { game: 'AoE4' }` sur le picker.

**Expected impact** : success rate 0 % → 80 %+ dès le prochain tick cron.

**Commit** : `48e2fd4` `fix(enrich): filter aoe4world batch to game='AoE4' only` — pushé sur master.

## État Railway 10 min après push

(à compléter une fois le tick cron passé — voir Monitor en cours.)

| Métrique | Avant | Cible | Live measure |
|----------|-------|-------|--------------|
| aoe4world batch success rate | 0/50 (0 %) | ≥ 80 % | ⏳ en attente |
| LP breaker open ? | YES (boucle infinie) | NO ou auto-clear | ⏳ en attente |
| Matches scraped (latest LP run) | inconnu | > 0 | ⏳ en attente |
| Failure breakdown lines visibles | NEW (commit e1d0bdd) | OUI dans logs | ⏳ en attente |
| `circuit breaker unlocked` lines | NEW (Problem 2 fix) | apparaît si IP réellement unblock | ⏳ en attente |

## Commits cette session (4 commits sur master, tous pushés)

```
48e2fd4  fix(enrich): filter aoe4world batch to game='AoE4' only
d34bbee  fix(scraper): surface real cause when AoE4 upcoming-page fetch fails
dd5870a  fix(lpscorer): treat 'IP not blocked' worker response as unblock signal
da5172f  chore(cleanup): apply team-players orphan cleanup (6 rows removed)
```

## Tests run en local (tous green)

```
$ SKIP_SERVER=1 npx tsx --test src/services/__tests__/liquipediaLiveScorer.test.ts
  pass 7/7  (initial state, trip 5min, reset, exp backoff, isIpUnblockedSignal × 2, cleanup)

$ SKIP_SERVER=1 npx tsx --test src/scrapers/__tests__/liquipediaScraper.test.ts
  pass 6/6  (P2002 fallback covered)

$ npx tsc --noEmit
  clean
```

## Risques résiduels

1. **Le batch peut encore avoir des failures** post-fix (par ex. si certains players AoE4 ont un slug inconnu d'aoe4world.com). Mais ce sera **diagnostique** grâce au logging granulaire — plus de "0 updated, 50 errors" silencieux.
2. **Si le worker proxy a vraiment un bug de routing** sur `/lp/token/generate`, le breaker auto-unblock va commencer à fonctionner mais on perdra ~5 min à chaque 429 réel. À surveiller — si on voit beaucoup de "circuit breaker unlocked", c'est ok ; si on en voit peu malgré 429s fréquents, le worker route est à corriger côté CF.
3. **Le filter `game: 'AoE4'`** signifie que les joueurs AoE2/AoE3/AoM ne sont jamais enrichis depuis aoe4world. C'est OK puisque aoe4world n'a pas de data pour eux. Si on voulait enrichir ces players, il faudrait une source dédiée (Liquipedia direct, ou aoe2.net pour AoE2).

## Action recommandée post-deploy

1. Surveiller Railway logs 15-20 min, chercher la nouvelle ligne :
   ```
   Player stats update complete: X updated, Y errors [profile_unresolvable=N, ...]
   ```
   `X` doit être > 0 et `Y` doit être petit.
2. Si `Y` reste élevé : creuser les exemples affichés sous `[aoe4world] Failure example (...)` lines.
3. Vérifier que `[Liquipedia] Worker reports IP unblocked — closing circuit breaker` apparaît au prochain 429+unblock cycle.
