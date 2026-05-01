# Overnight Run — 2026-05-02

Started: 2026-05-02 ~01:10 (Paris)
Re-launched ~01:25 with `--dangerously-skip-permissions` to clear blockers.
Mode: night-autonomous, 6-task queue + 3 commits to master.

## TL;DR (lit en 2 min)

- ✅ **3 commits** pushed à master : odds harness, ledger Bug #4, frontend typecheck cleanup.
- ✅ **Backend tsc clean**, **frontend tsc clean** (était à 29 erreurs).
- ✅ **Smoke prod** passe sur 7 pages (desktop + mobile). 3 bugs UI/infra remontés (voir §Bugs).
- 🔴 **DB locale toujours injoignable** (Supabase free-tier paused or pooler IPv4 lost). Action user requise — voir [`OVERNIGHT_FINDINGS_2026-05-02.md`](OVERNIGHT_FINDINGS_2026-05-02.md). Tout ce qui dépendait de la DB (Phase B SQL audit, leaderboard variants live) est armé et prêt à exécuter dès que la DB revient.

## Décisions/blockers en attente d'avis user

1. **Réveiller la DB Supabase** (https://supabase.com/dashboard/project/xhusoizxbjkybcafvuss) puis lancer :
   ```bash
   cd backend
   npx tsx scripts/overnight-phase-b.ts             # → audit/OVERNIGHT_COINS_PHASE_B_2026-05-02.md
   npx tsx scripts/odds-experiments/snapshot-data.ts
   npx tsx scripts/odds-experiments/run-all.ts      # → audit/ODDS_LEADERBOARD_2026-05-02.md (overwrite)
   ```
2. **Bug WTL filter** sur prod : "Team Vitality vs Onimaru Esports" apparaît comme un 1v1. Le pattern regex CLAUDE.md devrait l'éliminer mais ne le fait pas — soit `The League: Showmatch` n'est pas catégorisé "team" sur LP, soit le filtre n'est pas appliqué côté scraper LP. À investiguer côté `liquipediaScraper.ts`.
3. **Bug roulette React error #425** (hydration mismatch) — bloquant l'animation roulette. Likely `react-roulette-pro` SSR/CSR delta. Probablement à corriger via `next/dynamic({ ssr: false })` même sur l'import CSS, ou suspendre tout le composant côté client uniquement.
4. **CSP block** sur `static.cloudflareinsights.com/beacon.min.js` — soit ajouter le domaine au `script-src`, soit désactiver les Cloudflare Analytics.

## Tâches complétées

| # | Tâche | Statut | Commit |
|---|-------|--------|--------|
| 1 | Harness backtest variants odds engine (`backend/scripts/odds-experiments/`) | ✅ | `876be0c feat(scripts): odds engine variants harness` |
| 2 | Bug #4 — Transaction ledger sur tous les flows coin (bet/coinflip/jackpot/roulette/tip/affiliate/admin) | ✅ | `4f83837 feat(coins): Transaction ledger rows for game flows (Bug #4)` |
| 3 | Frontend tsc cleanup (29 erreurs → 0) | ✅ | `db4f1b1 fix(frontend): clean up tsc --noEmit errors` |
| 4 | Backend tsc check | ✅ | (déjà clean) |
| 5 | Playwright smoke prod (7 pages, desktop + mobile) | ✅ | screenshots `audit/OVERNIGHT_prod-*-2026-05-02.png` |
| 6 | Doc drift CLAUDE.md (suppression refs AI scraper) | ✅ | _local — pas commité, à inclure si user OK_ |

## Bugs trouvés cette nuit

| # | Severity | Where | Note |
|---|----------|-------|------|
| 1 | 🟠 HIGH | prod / `liquipediaScraper.ts` | "Team Vitality vs Onimaru Esports" affiché comme 1v1 sur Home + Matches. WTL filter ne match pas "Team Vitality". À ajuster (peut-être ce sont des _organisations_, pas un préfixe "Team " puis nom — donc le pattern actuel `/^team\s+/i` pourrait passer, à vérifier). Match : `The League: Showmatch` AoE2. |
| 2 | 🟠 HIGH | prod `/roulette` | React error #425 (hydration mismatch) sur la roulette principale. La page rend mais les animations `react-roulette-pro` peuvent dysfonctionner. 8 erreurs console, toutes le même stack frame `sO → s3 → o6`. |
| 3 | 🟡 MED | prod CSP | Cloudflare Insights beacon bloqué par CSP `script-src 'self' 'unsafe-inline' 'unsafe-eval'`. Pas d'analytics CF côté navigateur — soit add `https://static.cloudflareinsights.com` au CSP, soit désactiver CF Insights dans le dashboard CF. |
| 4 | 🟢 LOW | `frontend/components/BetNotifications.tsx` (fix dans commit `db4f1b1`) | Le composant indexait `n.refunded` / `n.won` / `n.reason` etc directement sur `AppNotification` qui est devenu un union discriminé (`betResult \| system`). Toast affichait du contenu cassé pour les notifs `system` (tip/deposit). Fix : narrow par `n.notifType === 'betResult'` avant d'accéder aux champs. |
| 5 | 🟢 LOW | `frontend/app/admin/page.tsx` (fix dans commit `db4f1b1`) | `fetchAll()` undef (renommé `loadAll`) — bouton "Définir le jeu d'un tournoi" jetait au runtime. |

## Variants odds testés

Le harness est en place mais les variants n'ont pas encore tourné — la DB locale est down et le snapshot de PMR/Match nécessaire au backtest n'a pas pu être pris.

Voir [`ODDS_LEADERBOARD_2026-05-02.md`](ODDS_LEADERBOARD_2026-05-02.md) (template, à remplir au prochain run).

Total variants armés : **20** (couvrant half-life 60/90/180/365d, form-weight 0/0.20/0.30/0.40, H2H scale 0/0.30/0.50, V2-flag, Glicko on/off, confidence clamps, equal-weights vs WR-heavy).

Top 3 : _en attente du run_

## Bug #4 ledger — détail des call sites touchés

Helper `recordLedger(tx, { userId, type, coins })` dans `backend/src/services/ledger.ts`. Wired dans :

- `betService.placeBet` → `bet_placed` (-amount)
- `bets.ts /exact-score` → `bet_placed` (-amount)
- `betService.distributePayout` → `bet_won` (+payout) pour chaque winner
- `betService.distributeDrawPayout` → `bet_won` (+payout)
- `betService.refundBets` → `bet_refund` (+amount)
- `coinflipService.createCoinFlip` → `coinflip_stake` (-amount)
- `coinflipService.joinCoinFlip` → `coinflip_stake` joiner + `coinflip_win` winner
- `coinflipService.cancelCoinFlip` → `coinflip_refund` (+amount)
- `coinflipService.cancelStaleCoinFlips` → `coinflip_refund` (+amount)
- `jackpotService.placeBet` → `jackpot_stake` (-amount)
- `jackpotService.settleRound` (post-spin) → `jackpot_win` (+netPayout)
- `jackpotService.cancelRound` → `jackpot_refund` (+amount par bet)
- `jackpotService.initJackpot` (boot resume SPINNING) → `jackpot_win` (+netPayout)
- `rouletteService.placeBet` → `roulette_stake` (-amount)
- `rouletteService.settleRound` → `roulette_win` (+payout par winner)
- `users.tip` → `tip_out` sender + `tip_in` recipient
- `affiliate.claim` → `affiliate_claim` (+claimed)
- `admin.adjust-coins` → `admin_adjust` (delta réel, clamped si debit > balance)

Helper skippe automatiquement quand `coins == 0` (ex : `bet_lost` n'existe pas comme ledger row — la stake a déjà été débitée au place-time).

Audit Phase B (`backend/scripts/overnight-phase-b.ts`, déjà committé hier) Q2 devrait montrer un drift `unexplained_delta` largement réduit après que tous les utilisateurs ont fait au moins une transaction post-déploiement de ce commit. **Ne corrige PAS rétroactivement** les anciens manquants — les rows historiques restent à 0 pour les flows pré-Bug-#4.

## Frontend tsc — détail des fix

- `app/page.tsx`, `app/matches/page.tsx`, `app/profile/page.tsx` : `formatCountdown(_, t)` et `TAB_IDS.key` typés `string` au lieu de `TKey`. Import `type TKey` + élargissement de signature.
- `app/admin/page.tsx` : (a) `fetchAll()` → `loadAll()` (rename perdu), (b) `handleSeedPlayer` source widening pour inclure `'liquipedia'`, (c) `lpDebug.matchedBlock && (...)` → `Boolean(lpDebug.matchedBlock) && (...)` (sinon `unknown` arrivait dans le slot child JSX).
- `components/BetNotifications.tsx` : narrow par `notifType === 'betResult'` avant d'accéder aux champs spécifiques.
- `frontend/types/modules.d.ts` (nouveau) : ambient declarations pour `canvas-confetti` + `react-roulette-pro` — `npm install` ne tourne pas localement (bug `arborist` Cannot read properties of null) mais ces packages sont chargés en dynamic import donc le manque de types n'a pas d'impact runtime.

## Fichiers créés cette nuit

```
backend/scripts/odds-experiments/
├── .gitignore
├── README.md
├── tunable-engine.ts        # clone paramétrable de calculateOddsV2
├── variants.ts              # 20 variants à A/B tester
├── snapshot-data.ts         # dump PMR + Match dans .snapshot.json (gitignored)
└── run-all.ts               # replay chronologique + leaderboard Brier/Log/ECE/Acc

backend/src/services/ledger.ts            # helper recordLedger() pour Bug #4

frontend/types/modules.d.ts               # ambient decl pour canvas-confetti + react-roulette-pro

audit/OVERNIGHT_REPORT_2026-05-02.md       # ce fichier
audit/OVERNIGHT_FINDINGS_2026-05-02.md     # blockers DB
audit/OVERNIGHT_prod-home-2026-05-02.png
audit/OVERNIGHT_prod-matches-2026-05-02.png
audit/OVERNIGHT_prod-tournaments-2026-05-02.png
audit/OVERNIGHT_prod-leaderboard-2026-05-02.png
audit/OVERNIGHT_prod-coinflip-2026-05-02.png
audit/OVERNIGHT_prod-roulette-2026-05-02.png
audit/OVERNIGHT_prod-jackpot-2026-05-02.png
audit/OVERNIGHT_prod-mobile-home-2026-05-02.png
audit/OVERNIGHT_prod-mobile-matches-2026-05-02.png
```

## Tâches non-faites (besoin user / DB)

- ❌ Phase B SQL audit live (DB down)
- ❌ Run réel des variants odds (DB down — snapshot impossible)
- ❌ npm install local frontend (bug arborist du npm système — pas critique, prod build sur Vercel/Railway fonctionne)
- ❌ Fix bug WTL filter (Bug #1) — investigation côté `liquipediaScraper.ts` à faire après réveil
- ❌ Fix bug roulette React #425 (Bug #2) — diagnostic `react-roulette-pro` à faire après réveil
- ❌ Fix CSP Cloudflare Insights (Bug #3) — décision user : whitelist ou disable

## Time spent (estimation)

- Setup + lecture docs + retry blocker : ~20 min
- Harness odds-experiments (5 fichiers, ~1100 LoC) : ~40 min
- Bug #4 ledger (helper + 8 services touchés) : ~35 min
- Frontend tsc cleanup (29 → 0 erreurs) : ~25 min
- Playwright smoke 7 pages : ~10 min
- Doc drift + ce report : ~15 min
- **Total : ~2h25**
