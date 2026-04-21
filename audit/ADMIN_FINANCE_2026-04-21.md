# Admin Finance — rapport de chantier

Date : 2026-04-21
Chantier : `/admin/finance` — dashboard analytics + finance owner-only
Status : **LIVRÉ (étapes 1 → 8)**

---

## Résumé exécutif

Création from-scratch d'un dashboard finance complet réservé au propriétaire du site, accessible sur `/admin/finance`. Triple couche d'auth (middleware backend + SSR guard server component + client re-check via next-auth). Zéro dépendance frontend ajoutée (sparklines, donut, line chart et wheel sont en SVG inline custom). Cache in-memory TTL-scoped par section pour tenir la charge sur le pooler Supabase free tier.

**7 sections fonctionnelles** + **1 pill P&L Summary** en tête, plus le **feed Anomalies** en bas comme safety net. Auth isOwner gated sur 2 endpoints + 5 helpers (voir § Sécurité).

---

## Périmètre livré

### Sections

| # | Section | Endpoint | Cache TTL |
|---|---------|----------|-----------|
| — | **P&L Summary** (pills today/7d/30d/lifetime) | `GET /admin/finance/pnl` | 60 s |
| 1 | **KPI cards** (GGR / NGR / cashflow / liability / deposits / withdrawals) | `GET /admin/finance/overview?range=` | 60 s |
| 2 | **Products breakdown** (6 produits + donut + table triable) | `GET /admin/finance/products?range=` | 120 s |
| 3 | **Affiliates** (4 KPIs + top 10 affiliés avec medals) | `GET /admin/finance/affiliates?range=` | 300 s |
| 4 | **User growth** (DAU/WAU/MAU + retention D1/D7/D14/D30 + signups daily + deposits histogram) | `GET /admin/finance/users?range=` | 600 s |
| 5 | **Cashflow** (liste paginée filtrable + CSV export) | `GET /admin/finance/cashflow?...` + `/export` | aucun (live ledger) |
| 6 | **Anomalies** (5 détecteurs + dismiss 7 j) | `GET /admin/finance/anomalies` + `POST /:key/dismiss` | 60 s |

### KPIs exposés

**Financial (coins + EUR)**
- GGR (Gross Gaming Revenue) = stakes - payouts (Bet + CoinFlip rake + Roulette + Jackpot rake)
- NGR (Net Gaming Revenue) = GGR - commissions affiliés créditées dans la fenêtre
- Net cashflow = deposits EUR - withdrawals EUR (completed uniquement)
- Active user liability = sum(User.coins) non-bannis (point-in-time)
- Deposits total / Withdrawals total en cents EUR
- Net realized profit (lifetime) = deposits cumulés - withdrawals cumulés - liability actuelle

**Product breakdown** (6 rows)
- Bets (MATCH / BO / EXACT_SCORE) / CoinFlip / Roulette / Jackpot
- Par produit : betsPlaced, volumeStaked, houseRevenue, marginPct

**Affiliates** (lifetime + period)
- Total commission payée, Active affiliates count, Avg commission per affiliate, Revenue share % (vol référé / vol total)
- Top 10 : userId, promoCode, commissionRate, referredUsersCount, volumeStakedByReferred, commissionPaid, roiRate

**User growth**
- DAU / WAU / MAU / Stickiness (DAU/MAU %)
- Deltas vs période précédente équivalente
- Sparkline DAU 7 derniers jours
- Signups daily / monthly (agrégation auto selon range)
- Retention D1/D7/D14/D30 (avg across valid cohorts, cohortCount exposé)
- Deposits frequency histogram lifetime (1× / 2× / 3-5× / 6-10× / 10+)

**Cashflow**
- Liste paginée avec filtres : type (deposit/withdrawal/bet_win/bet_loss/refund/bonus) + status (pending/completed/failed) + search username + min/max amount + range
- Export CSV UTF-8 BOM avec 11 colonnes

**Anomalies (5 détecteurs)**
- Sharps : winrate > 65 % sur ≥ 20 bets/30j (warning)
- Whales : net gain bets > 10 000 ⚜ sur 7j (warning)
- Gambling deposits : > 5 000 € déposés sur 7j (critical)
- Gambling losses : ≥ 20 bets perdus sur 24h (critical)
- Rake anomaly : margin produit hors [5 %, 25 %] sur 30j (warning/critical)

---

## Architecture technique

### Backend

- [backend/src/services/adminFinanceService.ts](backend/src/services/adminFinanceService.ts) — 1 fichier, 8 fonctions exportées (`computeFinanceOverview`, `computeProductBreakdown`, `computePnlSummary`, `computeAffiliateStats`, `computeUserGrowth`, `queryCashflow`, `exportCashflowCsv`, `detectAnomalies`) + helpers cache et dismiss in-memory.
- [backend/src/routes/adminFinance.ts](backend/src/routes/adminFinance.ts) — mount sur `/api/v1/admin/finance/*`, 10 routes, **toutes** gated par `requireOwner`.
- Aggregations SQL : `prisma.*.aggregate` + `prisma.*.groupBy` pour les cas natifs, `prisma.$queryRaw` pour DAU/WAU/MAU UNION 6 sources + retention CTE + anomalies (sharps/whales/loss streak/big depositors).
- Pas de fetch-all + reduce — toutes les agrégations se passent côté DB.

### Frontend

Arborescence [frontend/app/admin/finance/](frontend/app/admin/finance/) :
- `page.tsx` — server component, SSR guard + header
- `_components/FinanceDashboard.tsx` — client orchestration + URL sync + client guard defense-in-depth + stagger fade-in
- `_components/DateRangePicker.tsx`, `KpiCards.tsx`, `PnlSection.tsx`, `ProductsSection.tsx`, `AffiliatesSection.tsx`, `UsersSection.tsx`, `CashflowSection.tsx`, `AnomaliesSection.tsx`
- `_components/Sparkline.tsx`, `Donut.tsx`, `LineChart.tsx` — charts SVG inline réutilisables
- `_components/InfoTooltip.tsx` — click-popover stylé (remplace les `title=""` natifs)
- `_components/SectionFade.tsx` — wrapper framer-motion + `InlineError` partagé
- `_hooks/useFinanceFetch.ts` — ~100 lignes SWR-like (stale-while-revalidate, focus/visibility, polling 60s, `enabled` gate)

Total : 9 composants + 1 hook + 1 server page + 1 service backend + 1 router backend. Zéro dep ajoutée.

### Cache (in-memory)

`Map<string, { data, expires }>` dans `adminFinanceService.ts`. Clés :
- `finance:overview:{range}`
- `finance:products:{range}`
- `finance:pnl`
- `finance:affiliates:{range}:{limit}`
- `finance:users:{range}`
- `finance:anomalies`

TTLs : 60 s (overview / pnl / anomalies), 120 s (products), 300 s (affiliates), 600 s (users). Aucun cache sur cashflow (live ledger).

`POST /admin/finance/cache/clear?prefix=X` — force-refresh (retire les entrées matching `finance:{prefix}:`).

---

## Sécurité

### 3 couches d'auth

1. **Backend middleware** [backend/src/middleware/auth.ts](backend/src/middleware/auth.ts)
   - `requireOwner` = `requireAuth` + check `user.isOwner === true`
   - Tentative non-owner → 403 JSON + log warn Railway avec `userId`, `email`, `isAdmin`, `ip`, `route`
   - Utilisé sur toutes les routes `/api/v1/admin/finance/*` via `router.use(requireOwner)`

2. **SSR guard** [frontend/app/admin/finance/page.tsx](frontend/app/admin/finance/page.tsx)
   - Server component, `getServerSession(authOptions)` + `notFound()` si `!isOwner`
   - Non-owner reçoit la page 404 standard de Next — ne confirme PAS que la route existe

3. **Client defense-in-depth** [frontend/app/admin/finance/_components/FinanceDashboard.tsx](frontend/app/admin/finance/_components/FinanceDashboard.tsx)
   - Re-check `session.user.isOwner` côté client (couvre le cas d'un user démoté pendant qu'il regarde la page)
   - Affiche « Unauthorized » en l'espace d'une frame avant la redirection

### Propagation du flag `isOwner`

- Schema : `User.isOwner Boolean @default(false)`
- JWT payload : `{ userId, email, isAdmin, isOwner? }`
- `/users/me` expose `isOwner` → `jwt` callback NextAuth refresh le token à chaque check
- Session TypeScript typée : `Session['user'].isOwner: boolean`
- LeftSidebar affiche le lien « Finance » uniquement si `session.user.isOwner === true`

### Logs Railway sur tentatives non-owner

```
[Security] Non-owner tried owner-gated route GET /api/v1/admin/finance/overview
  — userId=cmnbq1r4k0000hlyvdqw72h1q email=… isAdmin=false ip=…
```

---

## Polish (étape 8)

- **Error isolation** : chaque section affiche son erreur inline via `InlineError` avec bouton « Réessayer ». Une section qui fail ne blank pas les autres.
- **Loading states** : skeletons CSS dans chaque section, pas de spinner générique. `useFinanceFetch` ne passe `loading: true` qu'au 1er fetch ou sur un refresh manuel, pas pendant le polling en arrière-plan → pas de flash.
- **Empty states** : chaque section a le sien en français (`« Aucune activité d'affiliation »`, `« Aucune transaction »`, `« Tout est clean »` avec icône Check verte sur Anomalies…).
- **Fade-in** : wrapper `SectionFade` autour de chaque section avec `delay` staggered (0 → 0.3 s). Entrée `opacity 0 + y 8 → opacity 1 + y 0` en 350 ms cubic-bezier.
- **Auth flash fix** : fetches gated par `ready = isOwner && tokenReady`. Plus de flash « Authentication required » au 1er render.
- **Click-popover tooltips** : remplace les `title=""` natifs (ugly, invisibles mobile) par `InfoTooltip` stylé qui ouvre au clic, ferme sur outside-click + Escape.
- **Responsive** : grille CSS 2 → 3 → 6 colonnes sur les KPI cards (`grid-cols-2 md:grid-cols-3 xl:grid-cols-6`), tables en `overflow-x-auto` avec colonnes non-essentielles cachées en mobile (`hidden md:table-cell`), charts en 1 colonne sur < lg.
- **ARIA labels** sur tous les boutons icon-only : refresh, pagination, dismiss, close modal, tooltip trigger.

---

## Limites connues

### In-memory state qui reset au restart Railway

1. **Cache finance** — retombe à zéro à chaque redeploy, pas dramatique (les TTL sont courts).
2. **Anomaly dismissals** — stockage `Map<key, expiresAt>` in-process. Un redeploy re-surface les anomalies dismissed. Acceptable pour solo operator ; migration DB (table `AnomalyDismissal`) si ça devient un problème.

### Approximations assumées

- **Affiliate commission par période** : pas de journal des commissions en DB. On prend les `AffiliateReferral` avec `lastActiveAt` dans la fenêtre et on utilise leur `commission` lifetime comme proxy. Sur `range=all` le chiffre est exact. Flaguée `isApproximation: true` dans la réponse, `InfoTooltip` l'explique côté UI.
- **Retention cohorts** : les cohorts trop jeunes pour atteindre D7/D14/D30 sont exclues du dénominateur de ce checkpoint. `cohortCount` retourne le nombre total de cohorts dans la fenêtre (pas le nombre éligible à chaque DN). Warning UI « ≥ 3 cohorts requis » si `cohortCount < 3`.
- **Whale detection** : Bet only (pas CoinFlip/Roulette/Jackpot) pour V1, commentaire dans le code.
- **Loss streak** : proxy = 20 bets LOST sur 24 h, pas vraiment une streak consécutive. Bon signal responsible gaming quand même.

### Hors-scope V2

- Journal des commissions d'affiliation pour période-scoped exact
- Cohort-by-cohort heatmap retention
- P&L waterfall chart / sankey flow
- Alerts email/Discord/webhook sur anomalies critical
- Scheduling direct d'events depuis le panel (brancher une table `EventSuggestion` → `BonusCampaign` actionnable)
- Multi-currency (on reste en EUR internally, coin interne)
- Tax reports export
- Predictions / forecasting

---

## Commandes SQL de référence

### Désigner un user comme OWNER

```sql
-- 1. Trouver le steamId via username
SELECT id, username, "steamId", email
  FROM "public"."User"
  WHERE username ILIKE 'targetUsername';

-- 2. Set isOwner via steamId (immuable, plus sûr que l'email)
UPDATE "public"."User"
  SET "isOwner" = true
  WHERE "steamId" = '76561199XXXXXXXXX';

-- 3. Vérifier qu'un seul user est OWNER
SELECT id, username, "isAdmin", "isOwner"
  FROM "public"."User"
  WHERE "isOwner" = true;
```

### Retirer les droits OWNER

```sql
UPDATE "public"."User"
  SET "isOwner" = false
  WHERE "steamId" = '76561199XXXXXXXXX';
```

### Appliquer la colonne `isOwner` (migration one-shot, déjà exécutée)

```sql
ALTER TABLE "public"."User"
  ADD COLUMN IF NOT EXISTS "isOwner" BOOLEAN NOT NULL DEFAULT false;
```

### Wipe data test (utilisé le 2026-04-21 pour nettoyer le soft-launch testing)

```sql
BEGIN;
DELETE FROM "RouletteBet";
DELETE FROM "JackpotBet";
DELETE FROM "Bet";
DELETE FROM "AffiliateReferral";
DELETE FROM "RouletteRound";
DELETE FROM "JackpotRound";
DELETE FROM "CoinFlip";
DELETE FROM "Transaction";
UPDATE "User" SET coins = 0, "totalWagered" = 0;
UPDATE "AffiliateCode" SET "totalEarnings" = 0, "available" = 0;
COMMIT;
```

### Force-refresh finance cache en prod (sans redeploy)

```bash
curl -X POST -H "Authorization: Bearer <owner_token>" \
  https://api.ageof.money/api/v1/admin/finance/cache/clear
```

### Force-scan anomalies (sans attendre le TTL)

```bash
curl -X POST -H "Authorization: Bearer <owner_token>" \
  https://api.ageof.money/api/v1/admin/finance/cache/clear?prefix=anomalies
# puis
curl -H "Authorization: Bearer <owner_token>" \
  https://api.ageof.money/api/v1/admin/finance/anomalies
```

---

## Commits clés

| Commit | Étape | Résumé |
|--------|-------|--------|
| `1778752` | 1 | `isOwner` + `requireOwner` + stub route + SSR-guard |
| `c9e0d4b` | 2 | service overview + products + cache in-memory |
| `622657a` | 3 | frontend overview + products (SSR + SWR custom) |
| `14b3f3e` + `593cedb` | 4 | affiliates backend + frontend |
| `7badbab` + `baaad9a` | 5 | user growth + retention + signups + histogram |
| `5f26963` + `5c75e85` | 6 | cashflow list + CSV export |
| `61b38c1` + `54beec3` | 7 | anomalies detection + dismiss |
| (ce commit) | 8 | polish + rapport final |

Entre les étapes, plusieurs commits de fix/polish : P&L summary, click-popover tooltips, Net GGR ligne, skip fetch tant que token pas prêt, etc.

---

## Check-list acceptance

- [x] Route `/admin/finance` accessible uniquement par l'OWNER (404 pour les autres)
- [x] 6 KPI cards cohérentes avec deltas + sparklines
- [x] Products breakdown donut + table triable + Net GGR ligne de désambiguïsation
- [x] Affiliates top 10 + 4 KPIs + medals or/argent/bronze
- [x] User growth DAU/WAU/MAU + retention + signups + deposits histogram
- [x] Cashflow paginé filtrable + CSV export UTF-8 BOM
- [x] Anomalies feed avec dismiss 7 j
- [x] P&L pills today/7d/30d/lifetime en tête
- [x] Filtres globaux (range + compare + refresh + data-as-of)
- [x] URL query params persistés (`?range=&compare=`)
- [x] Loading skeletons partout, empty states FR, errors isolés par section
- [x] Fade-in staggered, tooltips click-popover
- [x] Responsive desktop / tablet / mobile
- [x] 3 couches auth (middleware + SSR + client)
- [x] Logs Railway sur tentative non-owner
- [x] Cache in-memory TTL-scoped
- [x] Zero dep ajoutée frontend (SVG inline pour sparklines / donut / line chart)
- [x] Backend `tsc --noEmit` clean, frontend `tsc --noEmit` clean (sauf 3 erreurs pré-existantes non liées au chantier)

---

## Post-mortem / leçons apprises

1. **Migration Prisma + déploiement code simultané casse la prod** — quand j'ai ajouté `isOwner` dans le `select` de `requireAuth` et pushé sans appliquer la migration SQL d'abord, tout le site a crash (`The column User.isOwner does not exist`). **Leçon** : pour ajouter une colonne, toujours `ALTER TABLE` d'abord, puis pusher le code qui l'utilise. Applied to the 2 migrations de ce chantier.

2. **Le pooler Supabase session mode sature vite** — le pre-deploy `prisma db push` + backend live tenant des connexions partagent le même pool de ~15 sessions. Fix définitif : run `db push` manuellement (Supabase SQL Editor) quand nécessaire, ne pas le coller en pre-deploy Railway.

3. **`title=""` HTML ≠ tooltip UX** — même pour de l'info simple, un click-popover stylé est nécessaire pour que ça existe sur mobile et pour rester cohérent avec le dark theme. Composant `InfoTooltip` créé, réutilisé partout.

4. **SWR/React Query-like en 70 lignes** — pas besoin d'ajouter une dep pour stale-while-revalidate + focus/visibility refetch + polling. Custom hook `useFinanceFetch` couvre le besoin exact sans 20 Ko de dependency.

5. **In-memory dismissals = trade-off assumé** — pas de table DB pour les anomaly dismissals. Un redeploy re-surface ce qui reste concerning, c'est un feature pas un bug sur un dashboard solo-operator.
