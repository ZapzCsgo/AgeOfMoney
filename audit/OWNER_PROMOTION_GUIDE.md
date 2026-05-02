# Owner promotion guide

**Why :** Owner is the strict super-set above admin. Only the owner can mint
new redeem codes (`POST /api/v1/admin/redeem-codes`) and disable existing
ones. All other admin endpoints (read-only on redeem, plus the rest of
the admin panel) are gated by the regular `requireAdmin`. The owner gate
lives in `backend/src/middleware/auth.ts:121-134`.

## 1. Find your user_id

Pick whichever is easiest :

**Option A — via the API (you must already be signed in)** :
```bash
# In the browser devtools (F12 → Console tab) on https://ageof.money :
fetch('/api/v1/users/me', { credentials: 'include' })
  .then(r => r.json()).then(d => console.log(d.data.id));
```

**Option B — via Supabase SQL editor** :
```sql
SELECT id, username, email, "isAdmin", "isOwner"
FROM "User"
WHERE email = 'YOUR_STEAM_LINKED_EMAIL'
   OR username = 'YOUR_STEAM_USERNAME';
```

Copy the `id` (a `cuid`-looking string like `clxabc123…`).

## 2. Set OWNER_USER_ID in Railway

Railway dashboard → AgeOfMoney project → backend service → **Variables** tab :

```
OWNER_USER_ID = <id from step 1>
```

Save. Railway propagates env to the running pod within ~10 seconds — no
redeploy needed.

## 3. Run the promotion script

The script lives at `backend/scripts/promote-owner.ts`. It's idempotent
(safe to re-run on an already-promoted user).

**Option A — from Railway shell (preferred)** :
```bash
# In Railway → backend service → Deploy logs → "Open shell"
cd /app
npx tsx scripts/promote-owner.ts
```

**Option B — from your local machine** : you'd need the working DATABASE_URL
(the Supabase pooler URL — port 6543 with `?pgbouncer=true`). If you have
it in your local `.env`, just :
```bash
cd backend
OWNER_USER_ID=<your-id> npx tsx scripts/promote-owner.ts
```

Expected success output :
```
✅ User cl... (your-username, your@email) is now owner.
   isOwner=true, isAdmin=true
⚠️  Sign out + sign back in on the website to mint a fresh JWT with isOwner=true.
```

## 4. Refresh your JWT

The JWT carries the `isOwner` flag. The middleware reads from the JWT
(not from a live DB lookup) for performance. So **after the promotion**,
sign out and sign back in to mint a token that has `isOwner: true`. Old
tokens won't gain owner power until renewal.

## 5. Test owner access

Once signed back in, hit the owner-only endpoint with your bearer token :
```bash
# Get your token via devtools : Application → Local Storage → 'auth_token'
TOKEN="eyJ..."

# Should return 200 with an empty `data` array (no codes minted yet)
curl -H "Authorization: Bearer $TOKEN" \
  https://api.ageof.money/api/v1/admin/redeem-codes
```

If you get **403 Forbidden** → JWT doesn't have `isOwner: true` yet.
Sign out + sign back in.

If you get **401 Unauthorized** → token is invalid or expired.

If you get **200 OK with `data: []`** → 🎉 you're owner, ready to mint codes.

## 6. Mint your first launch codes

```bash
TOKEN="eyJ..."

# LAUNCH50 — 500 redemptions max, 14 days, 2× wagering
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://api.ageof.money/api/v1/admin/redeem-codes \
  -d '{
    "code": "LAUNCH50",
    "amount": 50,
    "maxUses": 500,
    "expiresAt": "2026-05-16T00:00:00Z",
    "wageringMultiplier": 2.0,
    "notes": "Reddit launch — first 500 redemptions"
  }'

# DISCORD10 — unlimited, 60 days, 1.5× wagering (lower friction)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://api.ageof.money/api/v1/admin/redeem-codes \
  -d '{
    "code": "DISCORD10",
    "amount": 10,
    "expiresAt": "2026-07-01T00:00:00Z",
    "wageringMultiplier": 1.5,
    "notes": "Discord welcome — unlimited"
  }'
```

Both endpoints return `201 Created` with the full code object on success.

Once a code is created, anyone can redeem it via the wallet modal. The
`/api/v1/redeem` endpoint always returns 200 (with `ok: true | false`)
so failure reasons can't be probed via HTTP code.

## Security checklist

- [ ] OWNER_USER_ID set in Railway (NOT in the repo `.env`)
- [ ] Promotion script run successfully — output shows `isOwner=true`
- [ ] JWT refreshed (signed out + back in)
- [ ] Test owner endpoint returns 200, not 403
- [ ] First test code minted + redeemable end-to-end before announcing
