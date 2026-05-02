# Redeem-codes feature — implementation report

**Date :** 2026-05-02
**Branch :** `feature/redeem-codes` (local only — not pushed)
**Scope :** End-to-end promotional bonus codes for the soft-launch on
Reddit / Twitter / Discord, with proper wagering requirements so we
can hand out coins without funding withdraw-cycle abuse.

---

## 1. What it does

A user types `LAUNCH50` in the wallet → receives **50 ⚜ in
`redeemLockedBalance`**. The locked coins are NOT spendable and NOT
withdrawable. They unlock when the user has wagered (across any product —
match bets, coinflip, jackpot, roulette) `wageringMultiplier × amount`
since redeem time. With a multiplier of 2 and a 50 ⚜ code, that's 100 ⚜
of total wagering before the bonus drops into spendable `coins`.

This is the standard casino-bonus model — anti-abuse without scaring off
legit users : the bonus is real money, but you have to play with it.

---

## 2. Components

```
backend/
├── prisma/
│   ├── schema.prisma                       (+RedeemCode, +Redemption, +User cols)
│   └── migrations/20260502120000_add_redeem_codes/
│       └── migration.sql                   (DO NOT autorun — apply manually)
├── src/
│   ├── services/
│   │   ├── redeemCodeService.ts            (everything : redeem, wagering, admin)
│   │   └── ledger.ts                       (+redeem_locked, +redeem_unlock types)
│   ├── routes/
│   │   ├── redeem.ts                       (POST /, GET /me/history)
│   │   └── adminRedeem.ts                  (GET, GET stats, POST, PATCH disable)
│   └── index.ts                            (mount + IP rate limiter)
frontend/
└── components/wallet/WalletModal.tsx       (Redeem section + history toggle)
```

Wagering hooks added to **all** stake-placing services in the same
`$transaction` as the coin debit :

- `betService.placeBet()`
- `coinflipService.createCoinFlip()` (creator stake)
- `coinflipService.joinCoinFlip()` (joiner stake)
- `jackpotService.placeBet()`
- `rouletteService.placeBet()`

Cancel/refund paths intentionally do *not* roll back wagering
progress — that would let users self-grief their own progress, and the
abuse case (bet-and-immediately-cancel-to-pad-progress) doesn't exist
because cancel paths require time passing or hard match-cancel events.

---

## 3. Schema additions

```prisma
model User {
  // existing fields …
  redeemLockedBalance   Decimal  @default(0) @db.Decimal(20, 8)
  totalWageringProgress Decimal  @default(0) @db.Decimal(20, 8)
  redeemCodes           RedeemCode[]
  redemptions           RedeemCodeRedemption[]
}

model RedeemCode {
  id                   String   @id @default(cuid())
  code                 String   @unique @db.VarChar(20)
  amount               Decimal  @db.Decimal(20, 8)
  maxUses              Int?
  currentUses          Int      @default(0)
  expiresAt            DateTime?
  minAccountAgeHours   Int?
  maxAccountAgeHours   Int?
  wageringMultiplier   Decimal  @default(2.0) @db.Decimal(3, 1)
  requiresMinDeposit   Decimal? @db.Decimal(20, 8)
  createdBy            String
  notes                String?
  disabled             Boolean  @default(false)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  creator              User     @relation(...)
  redemptions          RedeemCodeRedemption[]

  @@index([code])
  @@index([disabled, expiresAt])
}

model RedeemCodeRedemption {
  id                String   @id @default(cuid())
  codeId            String
  userId            String
  amount            Decimal  @db.Decimal(20, 8)
  wageringRequired  Decimal  @db.Decimal(20, 8)
  wageringStartAt   Decimal  @db.Decimal(20, 8)  // snapshot of user's totalWageringProgress at redeem time
  unlocked          Boolean  @default(false)
  ipHash            String?
  userAgent         String?
  redeemedAt        DateTime @default(now())
  unlockedAt        DateTime?

  code              RedeemCode @relation(...)
  user              User       @relation(...)

  @@unique([codeId, userId])           // race-safe one-redeem-per-user
  @@index([userId, unlocked])
  @@index([codeId])
  @@index([ipHash, redeemedAt])
}
```

Migration file lives at
`backend/prisma/migrations/20260502120000_add_redeem_codes/migration.sql`
and is gated behind manual review — see header comment.

To apply :
```bash
cd backend
npx prisma migrate deploy   # registers + runs the migration
# OR if you don't want a migration record :
npx prisma db push          # pushes schema only, no record
npx prisma generate         # regenerate client (replaces the type-erasure shim)
```

---

## 4. Race-safety design

Three concurrency hazards, three guards :

1. **Double redeem from the same user** — the `@@unique([codeId,
   userId])` constraint on `RedeemCodeRedemption`. We `create()` first ;
   a duplicate throws `P2002` which the service maps to
   `{ ok: false, reason: 'already_redeemed' }`.

2. **Code usage cap exceeded** — `updateMany({ where: { id, currentUses:
   { lt: maxUses } } , data: { currentUses: { increment: 1 } } })`. The
   `currentUses < maxUses` predicate makes the read-modify-write a single
   SQL UPDATE. Returns `count: 0` if some other request just bumped past
   the cap → service throws `REDEEM_MAX_USES_RACE` and bails. The `create`
   above is rolled back by the surrounding `$transaction`.

3. **Wagering progress vs redeem unlock race** — every wagering update
   AND the unlock check happen inside the same `$transaction` as the
   bet's coin debit. Postgres takes a row-level lock on the User row
   when we `UPDATE … totalWageringProgress`, so two concurrent bets
   can't both see "below threshold" and both miss the unlock.

---

## 5. Anti-abuse layers

All applied independently — failing any returns `{ ok: false, reason }` :

| Layer                  | Where                                | Tunable |
|------------------------|--------------------------------------|---------|
| Code expiry            | `redeemCodeService.redeemCode`       | `expiresAt`        |
| Max usage cap          | same                                 | `maxUses`          |
| Min account age        | same                                 | `minAccountAgeHours` (e.g. 168 = 1 week) |
| Max account age        | same                                 | `maxAccountAgeHours` (e.g. 24 for "new players only" promo) |
| Min historical deposit | same                                 | `requiresMinDeposit` (e.g. 5⚜ = "must have deposited at least 1 USD ever") |
| One redeem per user    | `@@unique` constraint                | hard, not tunable  |
| IP rate-limit          | `redeemIpLimiter` in `index.ts`      | 20 / hour          |
| Per-user rate-limit    | `redeemUserLimiter` in `routes/redeem.ts` | 5 / minute    |
| Owner-only writes      | `requireOwner` middleware            | hard               |
| IP fingerprint logged  | `RedeemCodeRedemption.ipHash`        | sha-256, not raw   |

The IP cap is the brute-force defense (cycling fresh Steam accounts
to enumerate codes from the same IP). The per-user cap stops a logged-in
script from hammering the codespace.

`/api/v1/redeem` always returns HTTP 200 on rejection (with `ok: false`
+ `reason`). This is deliberate : 4xx codes leak which validation step
failed, which a script can use to enumerate (e.g. "user_too_young" tells
you the code itself is valid).

---

## 6. Withdraw safety

No additional guard needed — `User.coins` (spendable) and
`User.redeemLockedBalance` (locked) are physically separate columns.
The withdraw endpoint already does
`tx.user.updateMany({ where: { coins: { gte: amount } }, ... })`, which
only sees spendable coins. Locked coins can never be withdrawn until
the wagering completes and they get atomically moved into `coins` by
`processWageringForBet`.

When the wagering threshold is crossed, the unlock journal entry
(`redeem_unlock` on `Transaction.type`) is paired with the coin move
in the same `$transaction` as the bet placement that triggered it.

---

## 7. Owner promotion (one-time, manual)

Code creation is gated by `requireOwner`. To make Zapz an owner :

```sql
UPDATE "User" SET "isOwner" = true WHERE email = '<your steam-linked email>';
```

After flipping the bit, sign out + sign in to mint a fresh JWT
containing `isOwner: true`. The `requireOwner` middleware checks the
JWT claim, not a live DB read, so the old token won't gain owner
power until renewed (intentional — narrows the blast radius if a
token leaks the moment after the flag was flipped).

`requireOwner` already logs every non-owner attempt at warn level —
look for `[Security] Non-owner tried owner-gated route` in Railway
logs to catch privilege-probing.

---

## 8. Decimal precision compromise

The redeem feature stores all amounts as `Decimal(20, 8)`, but the
legacy `User.coins` is still `Int`. When the wagering threshold is
crossed and we move coins from locked → spendable, the unlock service
does :

```ts
const amountInt = Math.floor(amount.toNumber());
```

Trade-off is that fractional bonuses lose < 1 ⚜ of precision on
unlock. Acceptable while we run whole-coin codes only ; the proper
fix is the global `Int → Decimal` migration documented in
`audit/MIGRATION_DECIMAL_PLAN_2026-05-02.md`.

---

## 9. Post-merge action items

1. **Apply the migration** : `cd backend && npx prisma migrate deploy`
2. **Regenerate Prisma client** : `npx prisma generate` — this replaces
   the type-erasure shim in `redeemCodeService.ts` with the real
   types. No code change needed ; the cast becomes a no-op.
3. **Promote the owner** with the SQL in §7.
4. **Mint launch codes** — once owner is set, hit the API or insert
   directly :
   ```sql
   INSERT INTO "RedeemCode" (id, code, amount, "maxUses", "expiresAt",
     "wageringMultiplier", "createdBy", "updatedAt", notes)
   VALUES
     ('cuid_launch50',  'LAUNCH50',  50,  500, NOW() + INTERVAL '14 days',
      2.0, '<owner-id>', NOW(), 'Reddit launch — first 500 redemptions'),
     ('cuid_discord10', 'DISCORD10', 10, NULL, NOW() + INTERVAL '60 days',
      1.5, '<owner-id>', NOW(), 'Discord welcome — unlimited');
   ```
   (Or use `POST /api/v1/admin/redeem-codes` with the owner JWT.)
5. **Schedule a post-launch sweep** (4 weeks out) to look for :
   - codes never redeemed → cull dead promos
   - ipHash bursts → potential multi-account that slipped past the IP
     limiter
   - low unlock rate (< 30 % of redemptions ever unlock) → wagering is
     too high, consider lowering on the next batch

---

## 10. Files changed (for reviewer)

```
M  backend/prisma/schema.prisma
A  backend/prisma/migrations/20260502120000_add_redeem_codes/migration.sql
A  backend/src/services/redeemCodeService.ts
M  backend/src/services/ledger.ts
M  backend/src/services/betService.ts
M  backend/src/services/coinflipService.ts
M  backend/src/services/jackpotService.ts
M  backend/src/services/rouletteService.ts
A  backend/src/routes/redeem.ts
A  backend/src/routes/adminRedeem.ts
M  backend/src/index.ts
M  frontend/components/wallet/WalletModal.tsx
M  frontend/components/ErrorPage.tsx     (404 fix bundled — see below)
M  frontend/app/not-found.tsx
A  frontend/scripts/clean-error-images.ts
A  audit/MIGRATION_DECIMAL_PLAN_2026-05-02.md
A  audit/REDEEM_CODES_FEATURE_2026-05-02.md
```

The ErrorPage / not-found / clean-error-images changes are unrelated to
redeem codes — they fix the misspelled "DEFEEAT" and the visible
Imagen watermark on the 404 page. Bundled into this branch because both
were targeted at the soft-launch readiness checklist.

---

## 11. What I deliberately did NOT do

- **Push this branch.** Local only per instruction.
- **Run the migration.** Header comment says manual apply.
- **Write fractional codes for v1.** All initial codes will be whole-coin.
- **Add a withdraw-side guard against locked balance.** Not needed —
  schema separation already enforces it (see §6).
- **Add an admin UI page.** Existing admin panel can call the `POST
  /api/v1/admin/redeem-codes` endpoint via curl/Postman ; a polished
  admin page can land later without blocking soft-launch.
