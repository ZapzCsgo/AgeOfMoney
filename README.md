# AgeOfMoney

Esports betting platform for Age of Empires tournaments — virtual coins,
crypto deposits, real tournament data.

## Status

🚀 Soft-launch live (May 2026). Coverage : AoE4, AoE2, AoE3, AoM
tournaments S/A tier (Liquipedia-sourced).

## Tech stack

- **Frontend** : Next.js 14 (App Router), TailwindCSS, shadcn/ui, NextAuth.js
- **Backend** : Node.js + Express, Socket.IO
- **Database** : PostgreSQL (Supabase) via Prisma ORM
- **Auth** : Steam OpenID via NextAuth.js + custom backend JWT
- **Payments** : NOWPayments / OxaPay (crypto)
- **Hosting** : Railway (backend), Vercel (frontend)

## Project structure

```
aoe4/
├── frontend/      Next.js 14 app, TailwindCSS, App Router
├── backend/       Node + Express API, cron jobs, scrapers
├── audit/         Engineering reports + decision records
├── docs/          Architecture + deploy notes
└── package.json   Root workspaces config
```

## Local dev

Detailed setup lives in each workspace's own `README` / `.env.example`.
The high-level :

```bash
# 1. Clone, install
git clone <repo> aoe4 && cd aoe4
cd backend && cp .env.example .env  # fill in your values
cd ../frontend && cp .env.example .env.local

# 2. DB schema
cd backend && npx prisma db push

# 3. Run both services in parallel from the root
npm run dev
```

See `backend/.env.example` for the full env-var list (Postgres pooler URL,
Steam OAuth, NOWPayments keys, etc.).

## Roadmap

- Civ × map data ingest (per-game stats)
- More odds variants behind feature flags (see `docs/ODDS_ENGINE.md`)
- Live spectator overlay for active matches

## Contact

Tech / partnership : `contact@ageof.money`

## License

Private — closed-source. © AgeOfMoney 2026.
