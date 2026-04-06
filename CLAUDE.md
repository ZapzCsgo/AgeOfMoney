# AgeOfMoney — Instructions pour Claude

## UI/Design — RÈGLES STRICTES

### Ressources shadcn/ui à utiliser ABSOLUMENT

- **Icônes** : https://www.shadcn.io/icon — icônes de qualité, dont des icônes crypto (ex: `/icon/cib-btc`, `/icon/cib-eth`, `/icon/cib-usdt`)
- **Backgrounds** : https://www.shadcn.io/background — backgrounds animés, dégradés, grilles, particules prêts à l'emploi
- **Composants** : https://ui.shadcn.com/docs/components — utiliser les vrais composants shadcn (Button, Card, Dialog, Badge, Input, Tabs, ScrollArea, etc.)

### Ne JAMAIS faire
- Inventer des SVG basiques pour les icônes crypto — utiliser les icônes shadcn/ui
- Utiliser des CSS classes génériques inventées — s'appuyer sur shadcn + Tailwind
- Faire des designs "IA" trop lisses et sans caractère — inspiration : CSGOEmpire, CSGORoll, CSGOBig
- Simuler des données — toujours connecter aux vraies APIs (backend Express, aoe4world.com, Liquipedia)

### Toujours faire
- Consulter shadcn.io pour les backgrounds et icônes avant de coder
- Utiliser les variantes et slots des composants shadcn pour la personnalisation
- Référencer des sites comme CSGOEmpire/CSGORoll pour l'inspiration UX betting
- Chat connecté via Socket.io réel (room "global")
- Données matchs depuis l'API backend réelle (`GET /api/v1/matches`)

## Stack technique
- Frontend : Next.js 14 + TailwindCSS + Shadcn/ui
- Backend : Node.js + Express (port 4000)
- BDD : PostgreSQL via Prisma ORM (Supabase)
- Realtime : Socket.io
- Auth : NextAuth.js + Steam uniquement (next-auth-steam@0.4.0)
- Paiements : NOWPayments (crypto) — PAS Stripe
- Hosting : Railway (backend) + Vercel ou Railway (frontend)

## Taux de change coins
- Dépôt : $1 = 1.69 ⚜
- Retrait : 1.69 ⚜ = $0.99

## Nom du site
**AgeOfMoney** (pas AOE4BET, pas aoe4bet)

## Palette couleurs
- Fond : `#07060f` (near-black indigo)
- Card : `#0d0b1a`
- Or principal : `#d4a017` / `#f5c842`
- Texte : `#e8e2f5`
- Border : `#1e1a30`

---

## Architecture & décisions techniques importantes

### Sources de données tournois
- **Source principale** : `https://www.ageofempires.com/eventscalendar/` — calendrier officiel AoE pour TOUS les jeux
  - Scraper : `backend/src/scrapers/aoeEventCalendarScraper.ts`
  - Technique : POST axios sur `admin-ajax.php?action=getEvents&nonce={nonce}` (pas de Puppeteer)
  - Mapping game codes : `age4→AoE4`, `age2→AoE2`, `age3→AoE3`, `ageM→AoM`, `age1→AoE1`
- **Matchs individuels** : Liquipedia (4 wikis scrapés : AoE4, AoE2, AoE3, AoM)
  - Scraper : `backend/src/scrapers/liquipediaScraper.ts`
  - URL pattern : `https://liquipedia.net/{wikiPath}/Liquipedia:Upcoming_and_ongoing_matches`
  - wikis : `ageofempires`, `ageofempires2`, `ageofempires3`, `ageofmythology`
  - **Seulement Tier S et A** — B/C filtrés

### Champ `game` sur Tournament et Match
- Valeurs : `"AoE4"` | `"AoE2"` | `"AoE3"` | `"AoM"` | `"AoE1"`
- Default : `"AoE4"`
- Permet de ne pas mélanger les données H2H/stats entre jeux
- Le prompt Claude AI s'adapte au jeu via `GAME_FULL_NAMES` et `GAME_LIQUIPEDIA_WIKI` dans `aiPlayerHistoryScraper.ts`

### Système de cotes (odds)
- **NE PAS utiliser l'ELO ranked** — uniquement les données tournoi/esport
- Priorité H2H : AI tournament records → platform matches → aoe4world custom
- aoe4world API : `?leaderboard=rm_custom` pour filtrer aux matchs tournoi seulement
- Modèle de cotes : `backend/src/services/oddsEngine.ts`
- Recalcul rapide (DB only) toutes les 10 min, enrichissement complet (API) toutes les 30 min

### Historique joueurs (PlayerMatchRecord)
- Table `PlayerMatchRecord` : un record par joueur par match
- Source AI : Claude Opus 4.6 (`claude-opus-4-6`) — Sonnet refuse les données niche AoE4
- `enrichPlayerWithAI(playerId, playerName, force, game)` dans `aiPlayerHistoryScraper.ts`
- Skip si déjà ≥ 50 records (sauf `force=true`)
- `enrichAllSparseH2H()` : tourne toutes les 6h pour les paires avec peu de données

### Filtres équipes WTL
- Les matchs WTL apparaissent comme 1v1 sur Liquipedia mais sont des matchs d'équipe
- Pattern regex pour filtrer : `/^team\s+|esports?\s*[ab]?$|\s+esports?$|esports?\s+[ab]$/i`
- Joueurs à NE PAS créer : "Team Virtus", "ELEOS" (l'équipe), "Rulers of Rome A", "Nocturna eSports B"

### Liquipedia rate limiting
- Notre IP peut se faire bloquer si trop de requêtes
- Pour débloquer : `curl https://liquipedia.net/token/generate` depuis le serveur, puis visiter l'URL dans un navigateur
- Délai entre requêtes : 3s entre wikis, 200ms entre matchs, 1500ms entre pages joueurs
- Solution long terme : API officielle Liquipedia v3 avec clé `LIQUIPEDIA_API_KEY`

### Déclencher les scrapers manuellement
- Depuis le backend local : `POST http://localhost:4000/api/v1/dev/scrape-liquipedia`
- Depuis l'admin (authentifié) : `POST /api/v1/admin/scrapers/run` body `{ "source": "liquipedia" }`
- Autres sources : `"tournaments"` (aoe4world), `"aoe4world"` (stats), `"enrich"` (recalcul cotes)

### Cron jobs (backend/src/cron/jobs.ts)
- Toutes les 15 min : scrape aoe4world tournaments
- Toutes les 30 min : sync calendrier AoE + scrape Liquipedia matchs + enrichissement complet
- Toutes les 10 min : recalcul rapide cotes (DB only)
- Toutes les 6h : AI H2H enrichment pour paires sparse
- Toutes les minutes : tick statuts matchs (UPCOMING→LIVE, stale LIVE→CANCELLED)
- Toutes les 10 min : distribution payouts

### Statuts matchs
- UPCOMING → LIVE : automatique quand `scheduledAt` est dépassé
- LIVE → CANCELLED : après 8h sans résultat et sans tracking aoe4world, ou 24h avec tracking
- Vérification résultats : `backend/src/services/liquipediaLiveScorer.ts` (parse wikitext Liquipedia)
  - Extraction brace-balanced `{{Match...}}` pour éviter les corruptions avec `split('|R')`
  - Seuil de victoire : `Math.max(dbNeeded, lpNeeded)` — DB format fait autorité

### Admin panel joueurs
- L'ELO ranked est inutile et n'est plus affiché
- Auto-seed : si un joueur a < 10 records, l'admin déclenche automatiquement `seed-all`
- Force-reseed si < 5 records (les joueurs avec très peu de data)
- Route : `POST /api/v1/admin/players/seed-all`

### Page d'accueil (frontend/app/page.tsx)
- Affiche les matchs UPCOMING/LIVE en priorité
- Quand pas de matchs UPCOMING : affiche section "Prochains Tournois" avec tournois tier S/A uniquement
- Les tournois terminés (endDate passée) et tier B/C sont filtrés
- Tournois triés par startDate croissant (les plus proches en premier)

### Profil public
- La bio s'affiche toujours — fallback "Aucune bio renseignée" en gris foncé si vide

---

## Commandes utiles

```bash
# Lancer le backend en dev
cd backend && npm run dev

# Lancer le frontend en dev  
cd frontend && npm run dev

# Push schema Prisma vers Supabase
cd backend && npx prisma db push --accept-data-loss

# Générer le client Prisma
cd backend && npx prisma generate

# Déclencher scraper Liquipedia (toutes les wikis AoE)
curl -X POST http://localhost:4000/api/v1/dev/scrape-liquipedia

# Déclencher enrichissement AI historique joueurs
curl -X POST http://localhost:4000/api/v1/dev/seed-ai-history

# Voir les logs scrapers en DB
curl http://localhost:4000/api/v1/admin/scrapers/logs
```

## Variables d'environnement importantes (backend/.env)
- `DATABASE_URL` : PostgreSQL Supabase
- `ANTHROPIC_API_KEY` : pour l'AI history scraper (Claude Opus 4.6)
- `NODE_ENV` : `development` ou `production`
- Les routes `/api/v1/dev/*` ne sont actives qu'en développement
