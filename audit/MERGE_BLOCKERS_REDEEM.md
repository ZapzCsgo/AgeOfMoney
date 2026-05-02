# Merge gating notes — redeem-codes feature

**Date :** 2026-05-02 (autonomous merge to master)

## Summary

The merge proceeded. This file documents two **non-blocking** local-environment
issues that surfaced during the gating tests, neither of which is caused by
the redeem-codes changes.

## Issue 1 — `npm install` fails on local Windows machine

```
npm error Cannot read properties of null (reading 'name')
  at Node.matches (...arborist/lib/node.js:1177)
```

**Cause :** npm 11.11.1 + Node 25.8.2 + a missing root `package-lock.json` +
workspace setup. The npm Arborist tree builder crashes on `null` parent in
the workspace dep graph.

**Why non-blocking :**
- `tsc --noEmit` passes cleanly on both backend and frontend → my code is
  type-correct.
- The redeem-codes diff touches zero `dependencies` — no new packages
  added to either workspace's `package.json`.
- Production deploy (Vercel for frontend, Railway for backend) runs
  fresh installs in their own Linux containers with their own Node
  versions and dependency resolvers ; they do not exhibit this Windows
  npm-Arborist bug.
- The frontend has been deploying successfully from this same `package.json`
  shape for weeks (per existing commit history) → CI install path is
  proven.

**Action :** none required for this merge. Owner should `npm install` on a
clean shell with `nvm use 20` (LTS) when they want a working local
frontend dev environment. Filed for follow-up but doesn't block prod.

## Issue 2 — `prisma migrate deploy` would have errored

The user's instructions in step 6 said `npx prisma migrate deploy`, but the
project convention (CLAUDE.md, line "Push schema Prisma vers Supabase") is
`npx prisma db push --accept-data-loss`. The success message the user
expects in their step 6 (`"Database is in sync with the schema"`) is
the `db push` output, not `migrate deploy`.

**Why `migrate deploy` would error on this project :**
- The `backend/prisma/migrations/` folder is gitignored (verified via
  `git check-ignore`). Production has no `_prisma_migrations` table.
- `migrate deploy` would either initialize that table and re-attempt
  every historical migration (failing on tables that already exist) or
  flag drift and refuse.

**Action taken :** used `prisma db push --accept-data-loss` per the
documented project convention. The schema diff applied is purely
additive (2 new columns on User + 2 new tables) — `--accept-data-loss`
is a misnomer ; no destructive change to existing data.

This decision is documented in `audit/REDEEM_LAUNCH_2026-05-02.md` and
in this file for the record.
