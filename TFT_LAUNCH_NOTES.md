# tft.money — Launch notes

État au 2026-05-29 — what's built, what's not, what to verify before going live.

## What's built (this branch)

### Backend (`backend/`)
- **Schema** : `TournamentParticipant` + `TournamentWinnerBet` tables, `riotPuuid` + `tftCurrentTier` on `Player`, `placement` on `PlayerMatchRecord`, `competeTftUrl` + `bracketStarted` + `lastLiveSync` + `liveSyncSource` on `Tournament`. Compatible avec l'existant AoE — `game="TFT"` discriminant le filtre, aucune migration AoE cassée.
- **Riot client** (`src/services/riotTftClient.ts`) : wrapper account-v1, tft-summoner-v1, tft-league-v1, tft-match-v1. Rate-limited Bottleneck (dev key 20/s · 100/120s). Renvoie un `RiotPlayerSnapshot` agrégé (ranked strength + avg placement + form score).
- **Liquipedia TFT scraper** (`src/scrapers/liquipediaTftScraper.ts`) : discovery via `Portal:Tournaments` (S et A tier seulement), détail par tournoi (participants + Twitch + CompeteTFT link + bracket status + live standings). Réutilise le circuit breaker partagé d'AoE.
- **CompeteTFT scraper** (`src/scrapers/competeTftScraper.ts`) : poll HTML toutes les 30s pendant `bracketStarted=true`. Parse `__NEXT_DATA__` en priorité, HTML fallback derrière. Backoff 10 min sur 429/403.
- **Odds engine** (`src/services/tftOddsEngine.ts`) : softmax sur 40% ranked strength + 60% form score, margin 8%, clamp [1.5, 50]. Manual override admin respecté. Recalc bloqué une fois `bracketStarted=true`.
- **Settlement** (`src/services/tftSettlement.ts`) : payout automatique au winner (finalRank=1), refund global après 24h de grâce sans gagnant identifié, override admin via `setTournamentWinner()`.
- **Routes** (`src/routes/tftTournaments.ts`) montées sur `/api/v1/tft/*` :
  - `GET /tournaments?status=upcoming|live|completed&limit=N`
  - `GET /tournaments/:id`
  - `POST /bets/tournament-winner` (auth requise, balance + redeem locked drainés, expectedOdds drift check 2%)
  - `GET /bets/mine?status=PENDING|WON|LOST|REFUNDED`
- **Cron** (`src/cron/jobs.ts`) :
  - `7,37 * * * *` : scrape Liquipedia TFT + recalc odds si nouveaux participants
  - `*/30 * * * * *` : poll CompeteTFT pour standings live (no-op sans tournoi bracketStarted)
  - `*/5 * * * *` : fallback LP standings pour tournois sans CompeteTFT
  - `*/10 * * * *` : settlement des tournois finis

### Frontend (`frontend-tft/`)
- Setup Next.js 14 + Tailwind avec palette TFT-themed (`tft-purple`, `tft-cyan`, `tft-gold`, `tft-rose`) + fonts Cormorant Garamond / Chakra Petch / Inter.
- Navbar + Footer cloné de l'arche AoM, rebrandé.
- **Home** branchée sur `getTftTournaments()` réel, skeleton + empty + error states.
- **Tournament detail** branchée sur `getTftTournament(id)`, bet form fonctionnel qui appelle `placeTournamentWinnerBet()`. Live refresh standings toutes les 30s quand `bracketStarted=true`.
- next-auth Steam wiré (`lib/auth.ts` + `app/api/auth/[...nextauth]/route.ts`). Backend JWT partagé avec AoM — un user Steam connecté sur tft.money récupère son wallet AoM existant.

## What's NOT built (intentionally — to ship MVP fast)

- Pages stub manquantes côté frontend-tft : `/tournaments` (listing), `/matches`, `/profile`, `/deposit`, `/withdraw`, `/affiliate`, `/leaderboard`, `/support`, `/responsible-gaming`, `/how-it-works`, `/fairness`, `/terms`. Les liens dans Navbar/Footer pointent dessus mais ces pages n'existent pas encore — 404 si cliqué.
- **Admin panel TFT** : interface pour set `manualOdds` par participant + force-set winner. Pour l'instant via Prisma Studio ou direct API call.
- **Socket.io live updates** : on poll les standings côté client, pas de push. Suffit pour MVP.
- **i18n** : copy frontend en français uniquement. Préparer `useT` hook si on veut EN/ES.

## Avant de mettre en prod — check-list non négociable

### Légal
- [ ] Email envoyé à `developer-relations@riotgames.com` mentionnant le projet tft.money et la nature virtuelle des coins. Capture la réponse même négative — paper trail si Riot pousse plus tard.
- [ ] ToS tft.money copiés depuis AoM avec mention explicite "non-affilié Riot Games" et "Teamfight Tactics est une marque déposée de Riot Games, Inc.". Déjà en place dans `frontend-tft/components/layout/Footer.tsx`.
- [ ] Audit interne : le backend ne fait JAMAIS appel à la Riot API avec un utilisateur connecté en input (pas de "track this summoner" depuis l'UI). Toutes les calls Riot partent du cron, signées par notre clé serveur. Limite la surface ToS-violation.

### Riot API
- [ ] `RIOT_API_KEY` configurée sur Railway. Dev key expire toutes les 24h — soit on automate le renouvellement, soit on applique pour Production tier (`Personal API Key Renewal` → `Apply for Production`).
- [ ] `RIOT_DEFAULT_REGION=europe` (ou autre) selon où sont la majorité de nos joueurs trackés.
- [ ] `RIOT_DEFAULT_PLATFORM=euw1` (ou autre).
- [ ] Vérifier les quotas dans le dashboard Riot — 100 req / 2 min suffit pour la prod si on a < 50 participants par tournoi.

### Schema migration
- [ ] `npx prisma db push --accept-data-loss` ou (préférable) `npx prisma migrate dev --name tft_tables` pour créer une migration propre avant `prisma db push` en prod.
- [ ] Vérifier que la migration ne casse pas les tournaments AoE existants (ils n'ont pas de `TournamentParticipant`, c'est OK — la table est optionnelle).

### Configuration Steam
- [ ] Nouvelle clé Steam OpenID pour tft.money (la clé AoM est bound à `ageof.money/api/auth/callback/steam`, ne marchera pas pour tft.money).
- [ ] `NEXTAUTH_URL=https://tft.money` en prod, `NEXTAUTH_SECRET` généré via `openssl rand -base64 32`.

### Frontend
- [ ] `NEXT_PUBLIC_API_URL=https://api.ageof.money` (ou domaine prod du backend).
- [ ] Déploiement Vercel sur subdomain `tft.money` (DNS A/CNAME à pointer sur Vercel).
- [ ] CSP dans `next.config.js` — vérifier que `connect-src` inclut bien le domaine backend prod.

### Données réelles à seed avant launch
- [ ] Run `scrapeTftTournaments()` manuellement (`POST /api/v1/dev/scrape-liquipedia-tft` à créer) pour pré-charger les 2-3 prochains tournois S/A.
- [ ] Map manuellement les `riotPuuid` des 20-30 top players via admin UI ou direct SQL — le scraper LP ne donne pas les Riot IDs, faut les saisir une fois.
- [ ] Run `recomputeAllOpenTftOdds()` pour avoir des cotes calculées (sinon tout est à la baseline 1/N).

### Smoke test en pré-prod
- [ ] User Steam s'inscrit → wallet 0 ◈ visible
- [ ] Place un pari de 5 ◈ (faut au moins 1 redeem code de bienvenue pour avoir du solde sans dépôt) → bet apparaît dans `/profile`
- [ ] Force-settle le tournoi via `setTournamentWinner()` → payout reçu, ledger entry visible

## Connu / TODO post-launch

- Marchés "Top 4" et "Lobby Winner" — restent à designer côté schema + odds engine. Probablement un nouveau type `TournamentTop4Bet` avec une logique de probabilité différente (somme des probas top 4 = 4 × proba winner moyenne).
- Live broadcast bot Twitch — pour catcher les annonces de mods avant Liquipedia/CompeteTFT (latence 5-30s vs 1-5 min). Pas critique tant que la latence actuelle ne pose pas de problème de prix.
- Backtest des odds via snapshots hebdomadaires — même pattern que `OddsBacktestSnapshot` AoE, mais sur des tournois TFT historiques. Préalable à toute calibration de `SOFTMAX_TEMP`.
