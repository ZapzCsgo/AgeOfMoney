# Overnight findings — 2026-05-02

## 🔴 Major blocker — local DB connection fails

**Symptom** : `npx tsx scripts/check-odds-state.ts` and any other script using `new PrismaClient()` returns `Can't reach database server at db.xhusoizxbjkybcafvuss.supabase.co:5432`.

**Hypotheses** :
1. Supabase free-tier project is paused (auto-pause après inactivité)
2. Local IP not whitelisted on Supabase (network IP whitelist)
3. DNS / firewall change

**Impact** :
- ❌ Phase B SQL audit (COINS_AUDIT_2026-04-23 §3) — cannot run
- ❌ Odds backtest experiments (need full PMR + Match data) — cannot run
- ✅ All code-only work (TypeScript, frontend, Playwright on prod, Railway MCP, audits) — unaffected

**What I did instead** :
- Built the Phase B script (`backend/scripts/overnight-phase-b.ts`) — ready to run when DB returns
- Built the odds variant harness (`backend/scripts/odds-experiments/`) so the user can run all variants in batch when DB is back
- Switched to code-only tasks: Bug #4 ledger work, frontend typecheck, code audits, Playwright smoke tests, doc drift

**Recommended user action** :
1. Open https://supabase.com/dashboard/project/xhusoizxbjkybcafvuss → wake the DB if paused
2. Or whitelist your dev IP (Settings → Database → Connection pooling)
3. Then run :
   ```
   cd backend && npx tsx scripts/overnight-phase-b.ts
   cd backend && npx tsx scripts/odds-experiments/run-all.ts   (once created)
   ```
