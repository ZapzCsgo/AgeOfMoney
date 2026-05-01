# Security audit — 2026-05-02 (read-only, prelaunch)

## 🚨 ALERT — CREDENTIAL LEAK CONFIRMED

**Supabase database password is in git history and currently on master.**

- Leaked value : `Forzag123*&JeSuisAuJapon` (URL-encoded `Forzag123*%26JeSuisAuJapon`)
- 41 occurrences in `git log --all -p`
- Currently visible in 2 tracked files on master :
  - `.claude/settings.local.json` — multiple Bash permission entries embed the full pooler URL with password
  - `audit/SUPABASE_STATUS.md` — documentation snippet shows the URL inline (was masked text but the password slipped in earlier when I logged it)

**Remediation already in motion** : you've started rotating the password
on Supabase. After rotation, **also do** :

1. Once new password is in place AND confirmed working on Railway :
2. Edit the two tracked files to replace every occurrence of the old
   password with `***` (the URLs are still useful documentation, just
   not the password). Commit + push.
3. **DO NOT** try to BFG-purge git history — the password is already
   rotated by then, so old refs are useless to anyone. History rewrite
   would break every collaborator's clone and Railway's deploy ref. Not
   worth it for a now-dead credential.
4. Going forward : never put credentials in `.claude/settings.local.json`
   Bash entries. Use `process.env.DATABASE_URL` only, set the env var in
   the shell before running scripts.

## Section 1 — Critical (à fix avant launch)

### C1. Credential leak (above)
**Status** : in remediation. Password rotation on Supabase + masking the
two committed files is sufficient. Not blocking — the new password isn't
exposed anywhere.

## Section 2 — High (à fix dans la semaine)

### H1. `/api/v1/matches`, `/api/v1/players`, `/api/v1/tournaments`, `/api/v1/rain`, `/api/v1/support` have NO endpoint-specific rate limiter

The global limiter is `500 req / 15 min / IP`. That's too generous for
data-heavy GET endpoints — a single bot can scrape the entire match
catalog at 33 req/min indefinitely. Other categories (bets, payments,
roulette, coinflip, jackpot, affiliate, users, admin) all have stricter
limiters. These five don't.

**Recommended fix** (don't apply yet, surface for review) :
```ts
// in backend/src/index.ts, alongside the existing limiters :
const dataReadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many data requests.' },
});
app.use('/api/v1/matches',     dataReadLimiter, matchesRouter);
app.use('/api/v1/players',     dataReadLimiter, playersRouter);
app.use('/api/v1/tournaments', dataReadLimiter, tournamentsRouter);
app.use('/api/v1/rain',        dataReadLimiter, rainRouter);
app.use('/api/v1/support',     dataReadLimiter, supportRouter);
```
100 req/min/IP is plenty for legit polling (the home page polls every 30 s)
but blocks scrapers cleanly.

### H2. Webhook idempotence runs AFTER processing, not before

`backend/src/routes/payments.ts` verifies HMAC, then PROCESSES the
deposit, then writes `Transaction.stripeSessionId`. The schema has
`stripeSessionId String? @unique`, so a duplicate webhook for the same
`track_id` will eventually conflict on the DB constraint — but only
AFTER the second processing pass touched the user's wallet.

In practice the existing `creditPaidDeposit` early-return guards against
double-credit by checking the existing transaction status (`if (tx.status
=== 'completed') return 'no-op'`). Verified safe in the current code.

**Recommended hardening** : add an upfront `findUnique` on
`stripeSessionId` BEFORE running the webhook business logic. ~5 LoC,
prevents the race entirely instead of relying on the late constraint.

## Section 3 — Medium (à fix dans le mois)

### M1. Two `console.log` in `oddsEngine.ts`

Lines 81 and 84 — fire only when feature flags are ON. Should be
`logger.info` for log routing consistency. Not security-relevant.

### M2. 6 `console.error` in frontend admin / payment-proxy components

All are error catches inside `try/catch` blocks. Don't leak data, but
admin-only views could surface stack info in browser devtools. Consider
swapping for `logger.error` once a frontend logger exists, or just
`console.warn` for non-actionable errors.

### M3. `/api/v1/admin/finance/export` could leak via CSV columns

(Not investigated in depth — flag for future audit.) If the export
includes raw user emails / IPs / payment refs, ensure it's gated to
isOwner-only (admins minus mods) and that the CSV is downloaded over
HTTPS only.

### M4. Supabase RLS not verified

Row-Level Security on Supabase tables is unverified from the audit
perspective — the app uses a single Postgres user (`postgres`) which is
the superuser. **Recommended** : create a dedicated app role with
strict per-table grants, switch `DATABASE_URL` to use it. Effort
moderate (~2 h), payoff large (defense in depth).

## Section 4 — Low (nice-to-have)

### L1. Helmet `frameguard` not explicitly configured
`helmet()` defaults to `X-Frame-Options: SAMEORIGIN` which is fine. The
explicit `crossOriginEmbedderPolicy: false` doesn't change framing.
Could add `frameguard: { action: 'deny' }` for explicit DENY.

### L2. `process.env.RAILWAY_GIT_COMMIT_SHA` exposed via `/api/v1/health`
Truncated to 7 chars (short SHA). Same level of disclosure as a typical
GitHub release page — unlikely to be a vulnerability vector. Acceptable.

### L3. Frontend `console.error` lines on the admin panel
Already covered in M2. Polish, not security.

### L4. No CSP on the API
`helmet({ contentSecurityPolicy: false })` is intentional — the API
serves only JSON. If a future error path leaks HTML, it'd render
without CSP protection. Mitigated by the API never serving HTML
intentionally.

## Section 5 — Tableau de synthèse

| Priority | Count | Status |
|----------|------:|--------|
| Critical | 1 | In remediation (Supabase password rotation in flight) |
| High     | 2 | TODO — rate limiters + webhook upfront-check |
| Medium   | 4 | TODO — log routing, RLS, finance export review |
| Low      | 4 | Nice-to-have polish |

## Section 6 — Recommandations launch

### ✅ Safe to launch ?

**Yes** — once the Supabase password rotation is complete and Railway
has the new value, the soft launch can proceed. The leaked password
becomes inert the moment it's rotated, and the High findings are
hardening (not currently exploitable in a damaging way given the small
user base).

### 🚨 Critical findings à fix avant launch

1. **Supabase password rotation** — in flight (you).
2. **Mask the password in `.claude/settings.local.json` and `audit/SUPABASE_STATUS.md`** — once rotation is confirmed, edit both files to replace the old password with `***`. Single commit. ~2 min. Old password being inert is acceptable, but leaving it visible in the repo is hygiene.
3. **Verify Railway has the new `DATABASE_URL`** — and that the backend redeployed cleanly with it (check logs for `Initializing cron jobs` after the env change took effect).

That's it for "must do before launch." Everything else can ship and be hardened in week 1.

### 📋 Plan d'action pour les 7 prochains jours

- **Day 1 (post-rotation)** : Mask passwords in committed files. Test
  `/api/v1/health` returns 200 on prod (commit `03f6503`).
- **Day 2** : Add `dataReadLimiter` to the 5 unprotected GET endpoints
  (Recommended fix in H1). 30 LoC, low risk.
- **Day 3** : Add the upfront `findUnique` idempotence guard in payments
  webhook (H2). 5 LoC.
- **Day 4-5** : Create a dedicated Supabase app role with strict grants
  (M4). Test against staging first.
- **Day 6** : Audit `/api/v1/admin/finance/export` payload (M3). Ensure
  CSV doesn't leak sensitive PII.
- **Day 7** : Convert `console.log/error` to logger calls in oddsEngine
  + frontend admin (M1, M2).

## What we checked (positive findings)

Things that ARE in good shape — no action needed :
- ✅ Admin routes : `router.use(requireAdmin)` at line 62 of `admin.ts`
  protects every sub-route. JWT middleware enforces `isAdmin` boolean.
- ✅ JWT signing : explicit `algorithms: ['HS256']`, `clockTolerance: 5`,
  7-day expiry. No `alg: none` confusion possible.
- ✅ CORS : whitelist-based, no wildcard. Allows requests with no Origin
  (curl/mobile) but rejects browser cross-origin requests not in the
  `FRONTEND_URL` list.
- ✅ Helmet active with HSTS preload, X-Robots-Tag noindex.
- ✅ `.env`, `.env.local`, etc. all in `.gitignore`. No `.env*` files
  tracked in git.
- ✅ No hardcoded secrets in `backend/src/` or `frontend/lib/` source.
  No JWT_SECRET literal, no Stripe key string, no Steam secret string.
- ✅ Webhook HMAC SHA-512 verification on raw body bytes (not JSON.stringify).
- ✅ Express `trust proxy 1` set — rate-limit IPs are correct behind Cloudflare.
- ✅ Body limit 100kb on `express.json` + `express.urlencoded`.
- ✅ Rate limiters on all financial / gameplay endpoints (bets, payments,
  coinflip, jackpot, roulette, affiliate, users).
- ✅ Dev routes (`/api/v1/dev`) gated behind `NODE_ENV !== 'production'`.
- ✅ Bug #4 ledger : every coin movement now writes a `Transaction` row
  in the same `$transaction` block as the balance update — auditable trail.
- ✅ No `req.body` / `req.headers` logged to logger.
- ✅ No `password` / `token` / `secret` / `creditCard` fields appear in
  any logger call.

## Methodology + caveats

- **Read-only** : no curl-based attack attempts, no SQLi probes, no port
  scans. Just `grep` + file reads.
- **Time budget** : ~50 min focused on the 12 sub-checks asked.
- **Out of scope** : full Supabase RLS audit, full payments end-to-end
  scenario, frontend XSS via inputs, file-upload paths (no upload
  endpoint exists), CDN cache poisoning.
- **Limitation** : the audit is point-in-time at commit `a3795b0`.
  Anything merged after this commit is unaudited.
