# Supabase status — 2026-05-02 (session 2 resume)

> ⚠️ **Password rotated 2026-05-02.** The connection-string password
> previously visible in this file's git history is now **INERT** — any
> credential snippet you see in `git log -p` for this path is dead and
> rejected by Supabase. The new password lives only in Railway env vars
> and `backend/.env` (both gitignored). All examples in this file have
> been redacted to `***REDACTED-AND-ROTATED***`.

## Connection issue & resolution

**Initial test** (DATABASE_URL = direct):
```
postgresql://postgres:***@db.xhusoizxbjkybcafvuss.supabase.co:5432/postgres
```
→ FAIL: `Can't reach database server at db.xhusoizxbjkybcafvuss.supabase.co:5432`

**Root cause**: `db.xhusoizxbjkybcafvuss.supabase.co` resolves to an IPv6
address (`2a05:d014:1c06:5f0f:c007:1224:3df8:76a3`) only — no A record. The
local network has no IPv6 reachability, so port 5432 times out.

The Pro upgrade does NOT change this : Supabase direct connections moved
to IPv6-only across all tiers when v6 was rolled out. The IPv4 path is the
**Supavisor pooler**, which is available on free + Pro alike (Pro just gets
higher session/transaction limits).

**Fix** (no .env edit needed, just export for this session):
```bash
export DATABASE_URL="postgresql://postgres.xhusoizxbjkybcafvuss:***REDACTED-AND-ROTATED***@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
```
→ OK : `players=541, matches=251, pmr=24726`

Note the differences vs the direct URL :
- host: `aws-1-eu-central-1.pooler.supabase.com` (IPv4, Frankfurt region)
- port: `6543` (transaction-pooled) instead of 5432
- user: `postgres.<project-ref>` (the pooler needs the project ref baked
  into the username) instead of plain `postgres`
- prefix on host: `aws-1-` (the new Supavisor scheme) — `aws-0-` is the
  legacy pgbouncer pooler that was retired for new projects.

Region was discovered by probe: 14 hostnames tried, only `aws-1-eu-central-1`
returned a successful auth.

## Recommendation for backend/.env

The user's prod likely runs on Railway with IPv6 connectivity, so the direct
DB URL works fine there. Devbox local needs the pooler URL.

Two clean options :
1. **Add a `.env.local`** that overrides `DATABASE_URL` with the pooler URL.
   Devs export it, prod ignores it.
2. **Switch the canonical `DATABASE_URL` to the pooler** for everyone — works
   for both local + Railway, only downside is the pooler caps at 200 sessions
   and transaction-mode disables a few session-only features (e.g. `LISTEN`).
   For this app neither is used → safe switch.

Will not modify .env in this run since it's the user's secret file and not
in scope of the current ticket. Documenting here for the morning.

## Snapshot egress estimate (Phase 2)

Run completed in 13.4 s through the pooler. Output : 3.9 MB on disk
(`backend/scripts/odds-experiments/.snapshot.json`, gitignored).

| Metric | Value |
|--------|-------|
| PMR rows loaded | 24 726 |
| Match rows loaded | 172 (COMPLETED with winnerId/resultScore) |
| File size | 3.9 MB JSON |
| Wire egress (estimated) | ~5-6 MB (JSON + protocol overhead, gzip rate ~1.5×) |
| Time | 13.4 s |

This is an **idempotent one-shot** : every subsequent variant run uses the
local snapshot instead of round-tripping to Supabase. Total egress for the
full 35-variant + exact-score run ≈ snapshot once = ~6 MB.

## Pooler+Prisma gotcha

Direct pooler URL with port 6543 fails with `prepared statement "s0" does
not exist` because Supabase Supavisor in transaction mode doesn't preserve
prepared-statement state across connections. Fix : append
`?pgbouncer=true&connection_limit=1` to the connection string. Prisma then
disables prepared statements and works fine.

Final working URL (export only, never commit):
```
postgresql://postgres.xhusoizxbjkybcafvuss:***@aws-1-eu-central-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1
```

Alternative for prod-style usage: port 5432 (session-pooled) supports
prepared statements without the flag, but caps total connections lower.
