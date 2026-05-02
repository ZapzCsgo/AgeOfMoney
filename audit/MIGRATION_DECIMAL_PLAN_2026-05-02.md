# Int → Decimal(20, 8) migration — coin amounts

**Status :** *Planned, not started.* Do **not** run this in production yet.
**Author :** auto-generated alongside the redeem-codes feature on 2026-05-02
because that feature was the first to require sub-integer coin precision.

---

## 1. Why migrate

The platform was built on `Int` for everything coin-shaped because :

- Steam-only sign-in + simple deposit→bet→withdraw loop made integer coins
  the obvious primitive.
- Postgres `Int` is 32 bits → caps at 2.1 B. We're nowhere near that, and
  `BIGINT` (`@db.BigInt`) was a quick escape hatch if we ever needed it.

Pressure to migrate now :

1. **Redeem-codes wagering** : the wagering multiplier is `Decimal(3, 1)`
   (1.5×, 2.5×, …). Multiplying an `Int` amount by a `Decimal` and storing
   the result back as `Int` silently truncates — fine for whole-coin codes
   but wrong as soon as a single fractional code ships.
2. **Crypto deposit conversion drift** : depositing $5.00 USDT at the
   posted rate (1.69 ⚜/$) gives 8.45 ⚜. We currently `Math.floor` to 8 —
   the user loses 0.45 ⚜ on every deposit. At launch volume this is
   negligible, but as soon as we run a "deposit gives exact value" promo
   we'll have to surface fractional balances.
3. **House-edge math** : roulette / coinflip / jackpot rake calculations
   already produce non-integer intermediates that get `Math.floor`-ed —
   a nightly drift between `SUM(stake)` and `SUM(payout) + house_take`
   that requires a reconciliation script (see `adminFinanceService`).

The redeem-codes feature side-steps the issue by isolating its columns
(`redeemLockedBalance`, `totalWageringProgress`, `RedeemCode.amount`,
`RedeemCodeRedemption.amount`) as `Decimal(20, 8)` from the start. They
talk to the legacy `User.coins Int` only at the unlock boundary, where
`Math.floor(decimal.toNumber())` is acceptable for now (codes will be
whole-coin amounts at launch).

---

## 2. Inventory

Every `Int` column in `prisma/schema.prisma` that represents coins or
fractional money. Other `Int` columns (counters, ELO, BO numbers, ms
durations, ticket ranges) stay `Int` — they're not money.

| Table                  | Column                | Current     | Target          | Notes |
|------------------------|-----------------------|-------------|-----------------|-------|
| `User`                 | `coins`               | `Int`       | `Decimal(20,8)` | spendable balance |
| `User`                 | `totalWagered`        | `Int`       | `Decimal(20,8)` | lifetime stat |
| `Bet`                  | `amount`              | `Int`       | `Decimal(20,8)` | placed stake |
| `Transaction`          | `amount`              | `Int`       | `Decimal(20,8)` | cents (deposits) OR coins (virtual) — kept on dual rail, see §6 |
| `Transaction`          | `coins`               | `Int`       | `Decimal(20,8)` | signed delta |
| `RouletteBet`          | `amount`              | `Int`       | `Decimal(20,8)` | also `payout`, `houseEdgeAmount` |
| `RouletteRound`        | `potTotal`, `rake`    | `Int`       | `Decimal(20,8)` | |
| `CoinFlip`             | `amount`, `rake`      | `Int`       | `Decimal(20,8)` | |
| `JackpotRound`         | `potTotal`, `rake`    | `Int`       | `Decimal(20,8)` | |
| `JackpotBet`           | `amount`              | `Int`       | `Decimal(20,8)` | `ticketFrom`/`ticketTo` stay `Int` (they're audit ranges) |
| `RainEvent`            | `amount`              | `Int`       | `Decimal(20,8)` | |
| `RainParticipant`      | `coinsReceived`       | `Int`       | `Decimal(20,8)` | |
| `AffiliateCode`        | `totalEarnings`, `available` | `Int` | `Decimal(20,8)` | |
| `AffiliateReferral`    | `totalDeposited`, `totalWagered`, `commission`, `netLossBalance` | `Int` | `Decimal(20,8)` | |

Roughly 25 columns across 11 tables.

---

## 3. Why `Decimal(20, 8)` and not `Numeric`

- 20 total digits, 8 fractional → max value `999_999_999_999.99999999`.
  Plenty of headroom — even at 1 ⚜ = $1 we cover trillion-dollar balances.
- 8 fractional digits is the BTC convention (1 satoshi = 1e-8). If we
  ever start denominating in BTC for crypto-native users it costs nothing.
- Prisma maps `Decimal(20, 8)` to `Decimal.js` on the client — we get
  exact arithmetic via `.add()` / `.mul()` / `.gte()`. Never coerce to
  `Number` for math (already enforced in `redeemCodeService.ts`).

---

## 4. Migration phases

The cardinal rule : **never break a running prod read or write**. Three
phases, each independently deployable, with a feature flag (or pure
no-op) gate at every step.

### Phase A — Shadow columns (zero-downtime, reversible)

1. Add `*_dec Decimal(20,8)` columns next to every column in §2 :
   ```sql
   ALTER TABLE "User"
     ADD COLUMN "coins_dec"        DECIMAL(20, 8) NOT NULL DEFAULT 0,
     ADD COLUMN "totalWagered_dec" DECIMAL(20, 8) NOT NULL DEFAULT 0;
   ```
2. Backfill from the existing `Int` :
   ```sql
   UPDATE "User" SET "coins_dec" = "coins"::numeric,
                     "totalWagered_dec" = "totalWagered"::numeric;
   ```
   Run in batches (`WHERE id IN (... LIMIT 5000)`) on a maintenance
   window or off-peak. With the user table sub-100k rows this is a
   single sub-second statement today, but the pattern is what matters.
3. Add a Postgres trigger on every coin-mutating column that mirrors
   `Int` writes into the shadow column. This buys safety while we ship
   step 4 — the shadow always equals the truth.

### Phase B — Dual-write at app layer

4. Update every service that writes a coin-shaped column to write **both**
   the `Int` AND the `Decimal` value in the same `$transaction`. Pure
   additive change, no read path moves. Drop the trigger from step 3
   the moment dual-write is fully deployed.
5. Run `audit/finance/dec_drift.ts` (to be written) for one week —
   it sums `Int` vs `Decimal` totals per table per day and alerts on
   any mismatch. Any mismatch = a write site we missed in step 4.

### Phase C — Cutover

6. Once §5 is clean for ≥ 7 consecutive days :
   - Flip every read in app code from the `Int` column to the `_dec`
     column.
   - Drop the `Int` columns.
   - Rename `_dec` → original name :
     ```sql
     ALTER TABLE "User" DROP COLUMN "coins";
     ALTER TABLE "User" RENAME COLUMN "coins_dec" TO "coins";
     ```
   - `prisma db pull && prisma generate` → the schema now declares
     `Decimal @db.Decimal(20, 8)` everywhere, and Prisma client returns
     `Decimal.js` instances on read.
7. Drop the `Math.floor()` workaround in `redeemCodeService` (search
   for `// User.coins is still Int`). Redeem unlocks then move full
   precision into spendable.

### Risks at each phase

| Phase | Risk | Mitigation |
|-------|------|------------|
| A     | Shadow column gets out of sync if app starts writing `Int` after backfill but before trigger lands | Run the backfill INSIDE the same transaction that creates the trigger : `BEGIN; CREATE TRIGGER…; UPDATE…; COMMIT;` |
| A     | Storage doubles for ~25 columns | Prisma uses `numeric` under the hood, ~16 bytes vs 4 for `Int`. With our row counts (<1 GB total) this is a non-issue. |
| B     | Dual-write site missed → silent drift | The `dec_drift.ts` cron is the gate. Don't proceed to Phase C until it's been clean for a week. |
| C     | Prisma client regen breaks every type signature touching a coin column | Branch the rename, run `prisma generate` locally, fix every `tsc` error, deploy as one PR. The shadow column buys you time to do this on a feature branch without prod pressure. |
| C     | Old clients (mobile, browser tab still open) POST `Int`-shaped JSON | Backend Zod schemas accept `z.union([z.string(), z.number()])` for amounts during the transition window (already the pattern in `adminRedeem.ts`). |

### Rollback plan

Phase A and B are pure additions — to roll back, drop the shadow column
and remove the dual-write code. Phase C is the only destructive step ;
before running it, take a `pg_dump` snapshot and keep it for 30 days.

---

## 5. What is NOT in this plan

- **`Transaction.amount` semantics.** This column carries USD cents on
  deposit/withdrawal rows AND coin counts on virtual rows. The migration
  preserves this duality — we just widen the type. A separate cleanup
  to split into `usd_cents` + `coins_dec` is filed but not blocked on
  this migration.
- **Affiliate `commissionRate` / `Decimal(3, 2)`** — already Decimal,
  unchanged.
- **`oddsAtBet`, `payout` on `Bet`** — already `Float` / `Int`. `payout`
  follows `amount` in step 2 ; `oddsAtBet` stays `Float` (multiplier,
  not money).

---

## 6. Estimated effort

- Phase A : ~ 2 hours (SQL + a couple of triggers + tests)
- Phase B : ~ 1 day (touch every coin-mutating service, write the
  drift script, ship the cron)
- Phase C : ~ 0.5 day actively + 7 days waiting for the drift gate to
  go green

Total wall-clock ~ 2 weeks ; total active time ~ 2 days. Cheap insurance
to take *before* we have a million users to maintain compatibility for.

---

## 7. Pre-flight checklist when we're ready to start

- [ ] Confirm Supabase plan supports `Decimal` columns at scale (it does
      — `numeric` is core Postgres)
- [ ] Open a tracking issue with this doc as the spec
- [ ] Branch `feature/decimal-coins`
- [ ] Phase A migration + trigger landed behind a `MIGRATE_TO_DECIMAL=1`
      gate
- [ ] Drift script + cron deployed before any read site moves
- [ ] Phase C scheduled in a low-traffic window (Tuesday 4 AM UTC)
