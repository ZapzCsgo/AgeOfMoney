# Egress audit — 2026-05-02 (overnight 2)

> **Context** : Supabase free-tier egress (5 GB/month) dépassé. Grace period
> jusqu'au 1er mai. La DB est actuellement injoignable depuis le devbox local
> (probablement déjà passée en read-only ou paused), donc cet audit est statique :
> code-reading + estimations grossières des volumes par appel.

## TL;DR

3 sinks dominent l'egress — tous dans le cron, rien côté HTTP user-facing :

1. **`recalcActiveMatchOdds` (cron `*/10 * * * *`)** — re-pull complet des PMR
   pour les 2 joueurs + tous leurs opposants à chaque tick. **~70-90 % de
   l'egress backend**.
2. **`runWeeklyOddsEngineBacktest` (cron Mon 3h UTC)** — bulk PMR + bulk
   Match scan. ~30 MB / semaine.
3. **`enrichAllUpcomingMatches` (cron `*/30 * * * *`)** — call l'API
   aoe4world (egress sortant + entrant) + writes. Smaller.

L'API HTTP user-facing (matchs, leaderboard, profile) est déjà bien cachée
(`matchListCache` 10 s, leaderboard 60 s, etc.) — ce n'est PAS le problème.

## Top 10 requêtes par coût d'egress estimé

Hypothèses : 1 PMR row ≈ 250 B (json overhead inclus), 1 Match row ≈ 800 B
sans includes ≈ 2 KB avec player+tournament includes, 1 Bet row ≈ 200 B.

| # | Site | Fréquence | Rows/call | Bytes/call | Bytes/h | Bytes/mois | Optim possible |
|---|------|-----------|-----------|------------|---------|------------|----------------|
| 1 | `recalcActiveMatchOdds` PMR opponents loop ([cron/jobs.ts:384](backend/src/cron/jobs.ts#L384)) | 6/h (per 10 min) × ~9 active matches | 3 000-15 000 | 750 KB-3.7 MB | 4.5-22 MB | **3-15 GB** | Cache PMR par playerId, TTL 5 min ; pré-calculer opp winrate map et la cacher 1 h |
| 2 | `recalcActiveMatchOdds` p1+p2 PMR ([cron/jobs.ts:343-350](backend/src/cron/jobs.ts#L343)) | 6/h × 9 matches × 2 | 200-500 each | 50-125 KB | 5-12 MB | **3-7 GB** | Cache PMR par (playerId, game) — réutilisable entre runs et entre matchs |
| 3 | `weeklyOddsEngineBacktest` PMR scan | 1× / semaine | ~25 000 | 6 MB | n/a | **24 MB/mois** | Streaming + projection select : déjà partiellement OK |
| 4 | `recalcActiveMatchOdds` activeMatches.findMany avec includes ([cron/jobs.ts:328](backend/src/cron/jobs.ts#L328)) | 6/h | 9 | ~20 KB | 120 KB | **86 MB/mois** | OK (déjà select-light côté player) ; hot-cache 60 s |
| 5 | `tickMatchStatuses` staleMatches avec includes ([cron/jobs.ts:268](backend/src/cron/jobs.ts#L268)) | 60/h | 0-3 | ~3 KB | ~10 KB | **7 MB/mois** | Restreindre `include` à `aoe4worldId` ; pas d'autre champ utilisé |
| 6 | `closeBetsPreMatch` `findMany` sans select ([cron/jobs.ts:308](backend/src/cron/jobs.ts#L308)) | 60/h | 0-3 | full row ~800 B × 3 = 2.4 KB | ~150 KB | **108 MB/mois** | `select: { id: true }` — la boucle ne touche qu'à `match.id` |
| 7 | `distributePayouts` completed.findMany sans select ([cron/jobs.ts:478](backend/src/cron/jobs.ts#L478)) | 6/h | 0-20 | up to 16 KB | 96 KB | **70 MB/mois** | `select: { id: true, winnerId: true }` — on n'utilise que ces 2 |
| 8 | `GET /matches` (default) | 1×/10 s (cache hit miss côté serveur) | 50 matches | 60 KB (avec includes) | 22 MB | **15 GB/mois** | Cache déjà OK ; passer le cache à 30 s pour la home (les odds bougent peu) ; ajouter HTTP `etag` |
| 9 | `GET /matches/:id` (UPCOMING/LIVE) | 1× / clic | 1 match + 5 P1 + 5 P2 | ~12 KB | n/a | dépend du trafic | Cache 30 s pour UPCOMING (cache absent aujourd'hui) ; déjà OK pour COMPLETED |
| 10 | `GET /matches/:id/h2h` | 1× / clic | 20 matches avec includes | ~40 KB | n/a | dépend du trafic | Cache 5 min |

**Total estimation egress backend = 30-50 GB / mois si baseline maintenue.**
On est ~6-10× au-dessus du quota 5 GB/mois.

## Optimisations implémentées cette nuit (commits suivants)

### Fix #1 — `closeBetsPreMatch` select-only
`prisma.match.findMany` → ajouter `select: { id: true }`. Économise ~108 MB/mois.

### Fix #2 — `distributePayouts` select-only
`prisma.match.findMany` → `select: { id: true, winnerId: true }`. ~70 MB/mois.

### Fix #3 — `tickMatchStatuses` staleMatches select-only
Restreint `include` à `{ aoe4worldId: true, verificationFlag: true }`. ~5 MB/mois.

### Fix #4 — Cache PMR par (playerId, game) avec TTL 5 min
Nouveau helper `backend/src/services/pmrCache.ts`. Branché dans
`recalcActiveMatchOdds` pour les 3 sites de findMany PMR (P1, P2, opponents).
Économie estimée : **5-10 GB/mois** en steady state.

Format du cache :
```typescript
type CacheEntry = { records: PmrRow[]; cachedAt: number };
const cache = new Map<string, CacheEntry>(); // key = `${playerId}|${game}`
const TTL_MS = 5 * 60 * 1000;
```

Invalidation : volontairement aucune. Le PMR change rarement (1-2 nouvelles
rows par joueur par jour) et la fenêtre de 5 min est largement OK pour les
cotes — le cron tourne toutes les 10 min de toute façon.

### Fix #5 — `GET /matches/:id` cache UPCOMING/LIVE 30 s
Aujourd'hui pas de cache (seulement COMPLETED qui a 1 h). Ajouter un hit
cache mémoire 30 s pour UPCOMING/LIVE — accordé avec le client `Cache-Control`
existant.

### Fix #6 — `GET /matches/:id/h2h` cache 5 min
H2H ne change qu'au moment d'un nouveau match COMPLETED — 5 min sans data
fraîche est invisible côté UX.

## À faire ensuite (pas implémenté ce soir, faute de temps)

- **Index manquant** : `PlayerMatchRecord(playerId, game, opponentId)` —
  vérifier qu'il existe via `pg_indexes`. La requête opp loop fait
  `WHERE playerId IN (…) AND game = ?` qui exploite cet index si présent.
- **Materialized view `mv_player_records_summary`** — agrégat
  (playerId, game, totalMatches, totalWins, byTier, byOpponent) refreshée
  toutes les 30 min. La cron oddsEngine la lirait au lieu de re-scanner les
  PMR brutes. Économie supplémentaire de ~3 GB/mois.
- **Switch Glicko PlayerRating en WHERE IN bulk** — quand `ODDS_ENGINE_V2_ENABLED`
  passera à true, la requête actuelle fait 1 raw SQL par match. Devrait être
  1 seul raw SQL pour tous les players à la fois.
- **Throttle outgoing WebSocket `oddsUpdate`** — actuellement 1 broadcast par
  changement, mais on peut debouncer 500 ms côté serveur.
- **Réduire `take: 50` sur `GET /matches`** — la home n'affiche que ~10 matchs.

## Methodologie / limitations

- Egress mesuré statiquement (analyse de code + estimation row sizes). Pas
  de mesure live possible (DB unreachable cette nuit).
- Les estimations row size utilisent les `select` clauses observées. Sans
  `select`, on assume le full row (Prisma sérialise toutes les colonnes).
- L'egress entrant (Supabase → app) compte vers le quota Supabase. L'egress
  sortant (app → user) compte vers Railway/Vercel — pas le sujet ici.
- Le calcul "Bytes/mois" assume 30 jours et une charge constante.

## Cf. également

- `audit/COINS_AUDIT_2026-04-23.md` — Bug #4 (ledger Transaction) ajoute des
  writes mais pas de reads supplémentaires, donc pas d'impact egress.
- `audit/OVERNIGHT_REPORT_2026-05-02.md` — contexte de la session précédente.
