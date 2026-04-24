# COINS AUDIT — 2026-04-23

End-to-end review of all flows that mutate `User.coins`. Scope : deposits,
withdrawals, betting (match + exact score), coinflip, roulette, jackpot, rain,
tips, admin adjustments, affiliate commission.

Methodology :
- **Phase A** — read-only static audit of every code path touching `coins`.
- **Phase B** — SQL queries to run in Supabase to detect drift, negatives,
  orphans, double-claims and ledger holes.
- **Phase C** — 7 manual scenarios to execute with two test accounts.
- **Phase D** — prioritized bug list + fix plan (atomic commits, one per
  bug). **No code changed yet**.

> Naming convention in the tables below :
> - ✅ race-safe / fully atomic / ledger-backed / notification OK
> - ⚠️ works but has a known gap (documented in Bugs section)
> - ❌ broken or unsafe

---

## 1. Flows table (Phase A result)

| # | Flow | File:line | Atomic ? | Race-safe guard ? | Transaction ledger ? | Socket `coinsUpdate` ? | Affiliate hook ? |
|---|------|-----------|----------|-------------------|----------------------|------------------------|------------------|
| 1 | Deposit credit (OxaPay webhook) | [payments.ts:115](backend/src/routes/payments.ts#L115) | ✅ `$transaction` | n/a | ✅ (flips `pending→completed` on the row created at invoice time) | ✅ | n/a |
| 2 | Deposit credit (admin sync recovery) | [payments.ts:193](backend/src/routes/payments.ts#L193) | ✅ (same `creditPaidDeposit`) | n/a (idempotent early-return) | ✅ | ✅ | n/a |
| 3 | Affiliate signup deposit bonus | [payments.ts:310](backend/src/routes/payments.ts#L310) | inlined into invoice coins | n/a | coins amount baked into the pending `Transaction` | ✅ at deposit credit | n/a |
| 4 | Withdrawal debit + OxaPay payout | [payments.ts:609](backend/src/routes/payments.ts#L609) | ✅ `$transaction` | ❌ findUnique→decrement (no `coins >= coinsInt` guard in the UPDATE) | ✅ (`transaction.type='withdrawal'`, `coins = -coinsInt`) | ❌ **no `coinsUpdate` emit** after debit | n/a |
| 5 | Withdrawal — OxaPay `Failed` refund | [payments.ts:543](backend/src/routes/payments.ts#L543) | ✅ | n/a (credit) | ✅ (flips withdrawal `pending→failed`) | ✅ | n/a |
| 6 | Withdrawal — our API error refund | [payments.ts:665](backend/src/routes/payments.ts#L665) | ✅ `$transaction([inc, update])` | n/a (credit) | ✅ (flips `pending→failed`) | ❌ **no `coinsUpdate` emit** | n/a |
| 7 | Match bet — place | [betService.ts:141](backend/src/services/betService.ts#L141) | ✅ `$transaction` | ✅ **`updateMany where coins>=amount`** (gold standard) | ❌ no `Transaction(type='bet_placed')` row | n/a (decrement path does not emit — frontend reads via bet response) | n/a |
| 8 | Match bet — exact-score place | [bets.ts:439](backend/src/routes/bets.ts#L439) | ✅ | ✅ `updateMany where coins>=amount` | ❌ same as above | n/a | n/a |
| 9 | Match bet — settle (WON/LOST) | [betService.ts:264](backend/src/services/betService.ts#L264) | ✅ batched `$transaction` | n/a (credit) | ❌ no `Transaction(type='bet_won'/'bet_lost')` | ✅ | ✅ `creditAffiliateOnBetResolved` |
| 10 | Match bet — draw settle (BO2 2-way wrong, legacy) | [betService.ts:326](backend/src/services/betService.ts#L326) | ✅ | n/a | ❌ | ✅ | ✅ |
| 11 | Match bet — refund (cancel / BO2 1-1 void) | [betService.ts:428](backend/src/services/betService.ts#L428) | ✅ batched | n/a | ❌ no `Transaction(type='bet_refund')` | ✅ | ❌ **no affiliate callback** (by design — refund is wager-neutral, should not pay commission) |
| 12 | Coinflip — create (deduct creator) | [coinflipService.ts:114](backend/src/services/coinflipService.ts#L114) | ✅ `$transaction` | ❌ findUnique→decrement (no `gte` guard) | ❌ no ledger row for the stake | ✅ | n/a until settlement |
| 13 | Coinflip — join + settle (deduct joiner + credit winner) | [coinflipService.ts:183](backend/src/services/coinflipService.ts#L183) | ✅ `$transaction` | ❌ same TOCTOU on the joiner | ❌ | ✅ for both sides | ✅ both creator + joiner |
| 14 | Coinflip — cancel (15 min) | [coinflipService.ts:293](backend/src/services/coinflipService.ts#L293) | ✅ | n/a | ❌ | ✅ | n/a |
| 15 | Coinflip — auto-expire (cron) | [coinflipService.ts:332](backend/src/services/coinflipService.ts#L332) | ✅ per-game `$transaction` (loop) | n/a | ❌ | ✅ | n/a |
| 16 | Roulette — place bet | [rouletteService.ts:258](backend/src/services/rouletteService.ts#L258) | ✅ `$transaction` | ❌ findUnique→decrement | ❌ | ✅ | n/a |
| 17 | Roulette — settle winners | [rouletteService.ts:184](backend/src/services/rouletteService.ts#L184) | ✅ batched | n/a | ❌ | ✅ | ✅ per bet |
| 18 | Jackpot — place bet | [jackpotService.ts:171](backend/src/services/jackpotService.ts#L171) | ✅ `$transaction` | ❌ findUnique→decrement | ❌ | ✅ | n/a |
| 19 | Jackpot — settle winner | [jackpotService.ts:398](backend/src/services/jackpotService.ts#L398) | ✅ `$transaction` | n/a | ❌ | ✅ | ✅ per bet |
| 20 | Jackpot — cancel (insuffisant participants) | [jackpotService.ts:464](backend/src/services/jackpotService.ts#L464) | ✅ single `$transaction` (loop) | n/a | ❌ | ✅ | ❌ no affiliate callback (same rationale as bet refund) |
| 21 | Jackpot — SPINNING resume on boot | [jackpotService.ts:553](backend/src/services/jackpotService.ts#L553) | ✅ `$transaction` | n/a | ❌ | ✅ | ⚠️ **affiliate hook is NOT fired for resumed rounds** — see Bug #7 |
| 22 | Rain — claim | [rainService.ts:191](backend/src/services/rainService.ts#L191) | ✅ 4-op `$transaction` | unique(rainId,userId) ✅ | ✅ **`Transaction(type='rain_claimed')`** — gold standard, only flow with a ledger row | ✅ | n/a |
| 23 | Tip (user → user) | [users.ts:321](backend/src/routes/users.ts#L321) | ✅ `$transaction` | ❌ findUnique→decrement | ❌ no `Transaction(type='tip_out'/'tip_in')` | ✅ both sender + recipient | n/a |
| 24 | Affiliate commission credit (on bet resolve) | [affiliateService.ts:58](backend/src/services/affiliateService.ts#L58) | ✅ `$transaction` | ❌ findUnique→compute→update (TOCTOU on `netLossBalance`) | n/a (AffiliateReferral.commission is the ledger) | ❌ **no user-facing socket when `affiliateCode.available` increases** | self |
| 25 | Affiliate — claim available | [affiliate.ts:174](backend/src/routes/affiliate.ts#L174) | ✅ `$transaction` | ❌ findUnique→update (double-claim possible) | ❌ no ledger row | ❌ **no `coinsUpdate` emit** | n/a |
| 26 | Admin — adjust coins | [admin.ts:779](backend/src/routes/admin.ts#L779) | ❌ **not in a `$transaction`** (findUnique + update) | ❌ | ❌ | ❌ no socket emit | n/a |
| 27 | Admin — cancel match (refund) | [admin.ts:250](backend/src/routes/admin.ts#L250) | delegates to `refundBets` ✅ | n/a | ❌ | ✅ | n/a |
| 28 | Admin — delete match (refund then delete) | [admin.ts:267](backend/src/routes/admin.ts#L267) | ✅ | n/a | ❌ | ✅ | n/a |
| 29 | Admin — dedup matches startup refund | [admin.ts:1207](backend/src/routes/admin.ts#L1207) | ❌ **two sequential awaits per bet, not wrapped** | n/a | ❌ | ❌ no socket emit | n/a |
| 30 | Startup — dedup cleanup (index.ts) | [index.ts:327](backend/src/index.ts#L327) | ❌ same as #29 | n/a | ❌ | ❌ | n/a |
| 31 | Cron — match verifier 8h/24h auto-cancel | [jobs.ts:290](backend/src/cron/jobs.ts#L290) | via `refundBets` ✅ | n/a | ❌ | ✅ | n/a |
| 32 | Scraper — invalid-data auto-refund | [liquipediaScraper.ts:912](backend/src/scrapers/liquipediaScraper.ts#L912) | via `refundBets` ✅ | n/a | ❌ | ✅ | n/a |

### Summary

| Dimension | Pass | Partial | Fail |
|-----------|------|---------|------|
| Atomicity (`$transaction`) | 28 | 0 | 4 (admin adjust, admin dedup refund, startup dedup, tip TOCTOU) |
| Race-safe decrement guard (`updateMany where coins>=amount`) | **2** (match bet + exact-score bet) | 0 | 7 (coinflip×2, jackpot bet, roulette bet, tip, withdrawal, admin adjust) |
| `Transaction` ledger row written | **2** (deposit credit, rain claim) | 0 | 20 (every other flow) |
| Socket `coinsUpdate` emitted | 22 | 0 | 8 (withdrawal×2, affiliate claim, admin adjust×3, dedup×2) |

---

## 2. Bugs & risks (Phase A findings)

Priority tags :
- 🔴 **CRITICAL** — can cause balance drift / negative coins / double-pay
- 🟠 **HIGH** — silent money leak or user-facing desync in a common path
- 🟡 **MEDIUM** — edge-case race, low exploit value, or observability gap
- 🟢 **LOW** — cosmetic / consistency cleanup

### Bug #1 — 🔴 Balance can go negative on 6 flows (missing race-safe decrement)

**Where** :
- [coinflipService.ts:118-121](backend/src/services/coinflipService.ts#L118) (create)
- [coinflipService.ts:188-191](backend/src/services/coinflipService.ts#L188) (join)
- [jackpotService.ts:191-197](backend/src/services/jackpotService.ts#L191) (bet)
- [rouletteService.ts:267-272](backend/src/services/rouletteService.ts#L267) (bet)
- [users.ts:324](backend/src/routes/users.ts#L324) (tip)
- [payments.ts:610-617](backend/src/routes/payments.ts#L610) (withdrawal)
- [admin.ts:795-800](backend/src/routes/admin.ts#L795) (admin adjust)

**Pattern used** :
```ts
const freshUser = await tx.user.findUnique({ where: { id }, select: { coins: true } });
if (!freshUser || freshUser.coins < amount) throw new Error('Insufficient coins');
await tx.user.update({ where: { id }, data: { coins: { decrement: amount } } });
```

**Why it's broken** : Postgres default isolation is Read Committed. `findUnique`
does NOT take a row lock. Two concurrent interactive transactions (user double-
clicks, or script sends 2 requests in parallel) can both read `coins=150`, both
pass the `< amount` check, then both run `decrement: 100`. Postgres serializes
the two UPDATEs (row lock) but **applies both decrements unconditionally** —
`coins` becomes `-50`. There is no DB-level guard that blocks negative balances.

**What works (reference)** : `betService.placeBet:141` and `bets.ts:440` use
`updateMany({ where: { id, coins: { gte: amount } }, data: { decrement } })` →
single SQL UPDATE, atomic, if balance is insufficient `count === 0` and we throw.
This is the only race-safe pattern in the codebase.

**Exploit path** : realistic via parallel HTTP — 2 tabs, 2 "Place bet" clicks
within ~50 ms, user ends with negative coins and has bet for double what they
had. Rain pings also arrive on two sockets simultaneously (if we add a claim
on jackpot/tip later this extends).

**Fix** : rewrite the six call sites to use the `updateMany where gte` pattern
from `betService.placeBet`. One commit per site to keep reviews small.

---

### Bug #2 — 🔴 Affiliate claim double-spend via TOCTOU

**Where** : [affiliate.ts:174-181](backend/src/routes/affiliate.ts#L174)

```ts
const claimed = await prisma.$transaction(async (tx) => {
  const freshAff = await tx.affiliateCode.findUnique({ where: { userId } });
  if (!freshAff || freshAff.available <= 0) return 0;
  await tx.user.update({ where: { id: userId }, data: { coins: { increment: freshAff.available } } });
  await tx.affiliateCode.update({ where: { userId }, data: { available: 0 } });
  return freshAff.available;
});
```

**Why** : same TOCTOU — two concurrent `/affiliate/claim` calls can both read
`available=1000`, both credit user +1000, both set `available=0`. User receives
`+2000`, `available` was only `1000`. The `$transaction` wrapper does NOT
prevent this under Read Committed.

**Fix** : replace with
```ts
const res = await prisma.affiliateCode.updateMany({
  where: { userId, available: { gt: 0 } },
  data: { available: 0 },
});
// If res.count === 1 we won the race — read pre-update value via returning
// clause (Prisma doesn't expose RETURNING on updateMany, so: SELECT before then updateMany({ available: 0, where: { userId, available: X }}) style).
```
Concrete pattern : `SELECT available FROM affiliate_code WHERE userId = ? FOR UPDATE` via `$queryRaw`, or drop to a raw `UPDATE ... RETURNING` that is atomic.
Alternative : use `prisma.$transaction(..., { isolationLevel: 'Serializable' })`.

---

### Bug #3 — 🟠 Affiliate `netLossBalance` race on concurrent bet resolutions

**Where** : [affiliateService.ts:58-108](backend/src/services/affiliateService.ts#L58)

`creditAffiliateOnBetResolved` reads `referral.netLossBalance`, computes
`newBalance = netLossBalance + netDelta`, then writes `newBalance` back. If two
bets resolve in parallel for the same referred user (which happens every time
the bet settlement cron resolves a match with multiple bets from the same
referred user), the last writer wins :

- netLossBalance=0, bet1 win (−200), bet2 loss (+100)
- T1 reads 0 → newBalance=−200 → writes −200, no commission
- T2 reads 0 → newBalance=+100 → writes 0, commission=25
- Expected : net −100 → carry −100, no commission
- Actual : `netLossBalance=0`, commission paid **on lost money**

Exploitable at scale. Under-pays in symmetric cases, over-pays when wins + losses
interleave.

**Fix** : the increment in `netLossBalance` must be atomic. Replace the
read-compute-write with an `increment: netDelta` UPDATE, then evaluate the
commission logic on the RETURNING value. Two-phase :
1. `UPDATE affiliate_referral SET netLossBalance = netLossBalance + ${netDelta} WHERE id = ... RETURNING netLossBalance` (single SQL).
2. If `newBalance > 0` : `UPDATE … SET netLossBalance = 0 WHERE id = ? AND netLossBalance = ${newBalance}` (CAS — only apply if unchanged since step 1).

All three writes have to be in a `Serializable` transaction, or the
commission counters need to use `increment` and a `netLossBalance` reset-when-
positive guard.

Impact : house pays slightly wrong commissions. Not immediate money leak but
accounting drift that will accumulate.

---

### Bug #4 — 🟠 Missing `Transaction` ledger rows for 20/32 flows

**Where** : every flow except deposits and rain claims.

The `Transaction` table is supposed to be the canonical coin ledger (used by
the admin finance dashboard at [adminFinanceService.ts] and to reconcile
user-visible "historique financier"). Today it only contains :
- `deposit` (type)
- `withdrawal` (type, stored as negative `coins`)
- `rain_claimed` (type)

Every other coin movement (bet place, bet settle, roulette, jackpot, coinflip,
tip, affiliate claim, admin adjust) has **no ledger entry**. Consequences :
- Admin finance KPIs under-report volume / GGR.
- A user's "historique" only shows deposits + withdrawals + rain claims.
- We cannot reconstruct `User.coins` from the ledger → drift is undetectable.
- Bug #1 exploits are invisible to forensics.

**Fix** : add a `Transaction.create` line to every flow. This is mechanical
but touches many files. Suggest a helper `recordLedger(tx, { userId, type,
coins, meta })` used inside each existing `$transaction`. Propose a separate
commit per bucket :
1. betService (bet_placed, bet_won, bet_lost, bet_refund)
2. coinflipService (coinflip_stake, coinflip_win, coinflip_refund)
3. jackpotService (jackpot_stake, jackpot_win, jackpot_refund)
4. rouletteService (roulette_stake, roulette_win)
5. users.tip (tip_out, tip_in)
6. affiliate.claim (affiliate_claim)
7. admin.adjust-coins (admin_adjust, with `reason` in meta)

Backwards-compatibility : existing enum `Transaction.type` is a free-text
`String` so we can add values without a migration. Verify with `grep 'type: '
backend/src/**/transaction.create`.

---

### Bug #5 — 🟠 Withdrawal debit does not emit `coinsUpdate`

**Where** : [payments.ts:609-628](backend/src/routes/payments.ts#L609)

After a successful withdrawal initiation the user's balance is decremented but
no `coinsUpdate` socket event is sent → wallet badge in header keeps showing
the old balance until they refresh or another event fires (rain, bet, etc.).

Only cosmetic but the UX is misleading — user might think the withdrawal
failed and retry.

**Fix** : after the `$transaction` on line 628, emit
```ts
const updatedUser = await prisma.user.findUnique({ where: { id: userId }, select: { coins: true } });
io?.to(`user:${userId}`).emit('coinsUpdate', { coins: updatedUser?.coins ?? 0, direction: 'down' });
```
Same fix for the refund-on-API-error path at line 665.

---

### Bug #6 — 🟠 Affiliate claim + admin adjust do not emit `coinsUpdate`

**Where** :
- [affiliate.ts:177](backend/src/routes/affiliate.ts#L177) — increment user coins but no socket emit
- [admin.ts:797](backend/src/routes/admin.ts#L797) — admin sets `coins: newBalance` but no socket emit + not wrapped in `$transaction`

Same symptom as Bug #5. Also in admin adjust the finance dashboard can't react
to changes until the user reloads.

---

### Bug #7 — 🟡 Jackpot SPINNING resume credits winner but does NOT trigger affiliate revshare

**Where** : [jackpotService.ts:549-593](backend/src/services/jackpotService.ts#L549)

When boot resumes a SPINNING round that had `winnerId + netPayout` persisted,
the winner is credited and the round is marked COMPLETED — BUT the
`creditAffiliateOnBetResolved` loop over `round.bets` (which happens in the
normal settle path at line 437) is NOT called. Any referred bettor who played
in that round gets no commission credit for the house.

**Fix** : after the boot-time `$transaction` at line 562, re-run the same
affiliate loop the normal settle path does. Need to `include: { bets: true }`
in the fetch on line 534 (currently the `alive` fetch doesn't include bets —
need to refetch with bets for each SPINNING row).

---

### Bug #8 — 🟡 `refundBets` fires `betResult` with `won: false` but `refunded: true`

**Where** : [betService.ts:459-469](backend/src/services/betService.ts#L459)

The socket payload has both `won: false` and `refunded: true, payout: bet.amount`.
Frontend has to interpret `refunded` specially. Not a bug per se but several
frontend components (match card, user bets page) display "Perdu" briefly before
checking the `refunded` flag. Observable flash of red.

**Fix** : introduce `status: 'REFUNDED'` in the socket payload and drop the
`won: false` for refund-case events. Frontend change in parallel.

---

### Bug #9 — 🟢 Startup dedup refund is not in a `$transaction`

**Where** :
- [admin.ts:1209-1211](backend/src/routes/admin.ts#L1209)
- [index.ts:329-331](backend/src/index.ts#L329)

Two separate `await` statements per bet : `user.update(increment)` then
`bet.update(REFUNDED)`. If the process crashes between them, the user is
credited but the bet stays PENDING — next boot would re-credit (no — actually
the dedup deletes the match at the end, so the bet vanishes too, but only if
we reach that line). Low likelihood. Also no socket emit so affected users
don't see the refund live.

**Fix** : wrap each bet in a mini `$transaction([user.update, bet.update])` and
emit `coinsUpdate` after.

---

### Bug #10 — 🟢 `refundBets` does not call `creditAffiliateOnBetResolved`

**Where** : [betService.ts:406-474](backend/src/services/betService.ts#L406)

Probably intentional : a refunded bet is wager-neutral (netDelta=0) so no
commission should be paid. BUT `creditAffiliateOnBetResolved` also updates
`totalWagered` and `lastActiveAt` on the referral — skipping it means the
referral's `totalWagered` stays inflated by the original bet.

If we want the accounting to be clean : either (a) revert the
`totalWagered: { increment: stakeAmount }` that was done at place-time (but
we never recorded it on the referral at place-time — `creditAffiliateOnBetResolved`
is only called at SETTLE), so actually there is nothing to revert. **No bug,
but confirm**.

Verify : at bet PLACE time, do we touch `affiliateReferral.totalWagered` ?
Looking at the code : no, we only touch `User.totalWagered`. So a refunded
bet inflates `User.totalWagered` but not `AffiliateReferral.totalWagered`.
Minor data inconsistency, low impact.

---

## 3. Phase B — SQL queries to execute

Run these in the Supabase SQL Editor. Paste the output back so we can
triage anything non-empty.

### Q1 — Users with negative coins (Bug #1 exploit detection)

```sql
SELECT id, username, coins, "totalWagered", "createdAt"
FROM "User"
WHERE coins < 0
ORDER BY coins ASC
LIMIT 50;
```

Expected : **0 rows**. Any hit = Bug #1 already exploited in prod.

### Q2 — Balance drift vs. ledger (deposits + withdrawals + rain only)

```sql
WITH ledger AS (
  SELECT
    "userId",
    SUM(coins) AS net_ledger
  FROM "Transaction"
  WHERE status = 'completed'
  GROUP BY "userId"
)
SELECT
  u.id,
  u.username,
  u.coins         AS current_coins,
  COALESCE(l.net_ledger, 0) AS ledger_net,
  u.coins - COALESCE(l.net_ledger, 0) AS unexplained_delta
FROM "User" u
LEFT JOIN ledger l ON l."userId" = u.id
WHERE ABS(u.coins - COALESCE(l.net_ledger, 0)) > 0
ORDER BY ABS(u.coins - COALESCE(l.net_ledger, 0)) DESC
LIMIT 30;
```

Expected : every user has `unexplained_delta != 0` because bets/rouletteBets/
coinflip/jackpot/tips are NOT in the ledger (Bug #4). The interesting line
is users with **very large** `unexplained_delta` positive — flag for manual
review.

### Q3 — Bets PENDING on CANCELLED / past matches (ledger orphans)

```sql
SELECT b.id, b."userId", b."matchId", b.amount, b."createdAt",
       m.status AS match_status, m."scheduledAt"
FROM "Bet" b
JOIN "Match" m ON m.id = b."matchId"
WHERE b.status = 'PENDING'
  AND (
    m.status IN ('CANCELLED','COMPLETED')
    OR m."scheduledAt" < NOW() - INTERVAL '24 hours'
  )
ORDER BY m."scheduledAt" DESC
LIMIT 50;
```

Expected : **0 rows**. Hits = bets that never got refunded / settled. Manual
refund needed.

### Q4 — Double-claim detection on rain (belt-and-braces vs. unique constraint)

```sql
SELECT "rainId", "userId", COUNT(*) AS claim_count
FROM "RainParticipant"
GROUP BY "rainId", "userId"
HAVING COUNT(*) > 1
LIMIT 20;
```

Expected : **0 rows**. The unique constraint should make this impossible, but
verify after any schema migration.

### Q5 — Affiliate claim race detection

```sql
-- AffiliateCode.available should never be negative
SELECT id, code, "userId", available, "totalEarnings"
FROM "AffiliateCode"
WHERE available < 0
LIMIT 10;

-- AffiliateReferral.commission sum vs AffiliateCode.totalEarnings (should match)
SELECT
  ac.code,
  ac."totalEarnings"                         AS code_total,
  COALESCE(SUM(ar.commission), 0)             AS referrals_sum,
  ac."totalEarnings" - COALESCE(SUM(ar.commission), 0) AS drift
FROM "AffiliateCode" ac
LEFT JOIN "AffiliateReferral" ar ON ar."affiliateCodeId" = ac.id
GROUP BY ac.id, ac.code, ac."totalEarnings"
HAVING ac."totalEarnings" - COALESCE(SUM(ar.commission), 0) <> 0
LIMIT 30;
```

Q5b expected : 0 rows. If `drift != 0`, Bug #3 is already visible in prod.

### Q6 — Jackpot integrity

```sql
-- Rounds SPINNING for more than 60 s (stuck, boot-resume should have fired)
SELECT id, status, "createdAt", "closingAt", "winnerId", "netPayout"
FROM "JackpotRound"
WHERE status = 'SPINNING'
  AND "createdAt" < NOW() - INTERVAL '1 minute'
LIMIT 20;

-- Completed rounds where paid_coins != netPayout (would mean something weird)
SELECT jr.id, jr."winnerId", jr."netPayout", jr."potTotal", jr.rake,
       (jr."potTotal" - jr.rake) AS expected_payout
FROM "JackpotRound" jr
WHERE jr.status = 'COMPLETED'
  AND jr."netPayout" IS NOT NULL
  AND jr."netPayout" <> (jr."potTotal" - jr.rake)
LIMIT 30;
```

Expected : 0 rows each.

### Q7 — Withdrawal consistency

```sql
-- Pending withdrawals older than 48 h (should have been auto-failed)
SELECT id, "userId", amount, coins, status, "createdAt"
FROM "Transaction"
WHERE type = 'withdrawal' AND status = 'pending'
  AND "createdAt" < NOW() - INTERVAL '48 hours'
LIMIT 30;

-- Withdrawals marked failed where user was NOT refunded (coins still debited)
-- Hard to verify without a ledger, so we at least check the stripeSessionId is set
SELECT id, "userId", amount, coins, status, "createdAt", "stripeSessionId"
FROM "Transaction"
WHERE type = 'withdrawal' AND status = 'failed'
  AND coins < 0  -- coins is stored negative for withdrawals
ORDER BY "createdAt" DESC
LIMIT 30;
```

Q7 expected : 0 rows for Q7a. Q7b needs manual triage — if `status='failed'`
and we refunded, fine; if we didn't (bug in one of the refund paths), user is
owed coins.

---

## 4. Phase C — Manual test scenarios

Run with 2 test accounts (call them **A** = attacker / stress-tester,
**B** = victim / counterparty). Keep the DevTools Network panel open on
both tabs.

### S1 — Double-spend via coinflip (Bug #1 #12)

1. Account A has 100⚜. Open [/coinflip](frontend/app/coinflip/page.tsx) in **two tabs**.
2. In each tab, click "Create coinflip" with amount 100⚜ simultaneously
   (within 200 ms).
3. **Expected (post-fix)** : one request 201, one 400 "Insufficient coins".
   Balance = 0.
4. **Current (bugged)** : both 201, balance = **−100**. Two coinflips
   WAITING for 100⚜ each.

### S2 — Double-spend via withdrawal (Bug #1 #4)

1. Account A has 200⚜. Open `/deposit` in two tabs (ignore the page — just open
   it so cookies are set).
2. From the DevTools console, fire two parallel `POST /api/v1/payments/crypto/withdraw`
   with coins=169, same USDT address. One session per tab.
3. **Expected** : one 200, one 400. Balance = 31⚜.
4. **Current** : both 200, balance = **−138**, two pending withdrawals.

### S3 — Double-claim affiliate (Bug #2)

1. Account A has `affiliateCode.available = 1000` (set it via SQL if needed).
2. Fire two parallel `POST /api/v1/affiliate/claim`.
3. **Expected** : one returns `{ claimed: 1000 }`, one returns 400.
   Balance += 1000, available = 0.
4. **Current** : both return `{ claimed: 1000 }`. Balance += 2000,
   available = 0, site is down 1000⚜.

### S4 — Concurrent bets on same match (already race-safe, regression test)

1. Account A has 100⚜. Open a match page.
2. Place two bets in parallel of 80⚜ each on the same match.
3. **Expected** : one 201, one "Insufficient coins". Balance = 20.
4. Run periodically to catch any accidental regression to the TOCTOU pattern.

### S5 — Jackpot boot-resume preserves bets (already fixed, regression test)

1. Two accounts A and B each bet 50⚜ on the current jackpot round (pot = 100⚜).
2. Restart the backend (Railway redeploy or `Ctrl-C` + `npm run dev`).
3. **Expected** : bets are preserved, round resumes, balance unchanged.
4. After the spin, the winner is credited. Verify `coinsUpdate` socket fires.

### S6 — Coinflip 15-min auto-cancel refund (Bug #1 #14)

1. Account A creates a coinflip 100⚜. Leaves it open.
2. Wait 16 min.
3. **Expected** : cron auto-cancels. Account A gets `coinsUpdate` +100,
   `totalWagered` reverts. `coinflip.status = CANCELLED`.
4. Verify no `Transaction` row for the refund → Bug #4.

### S7 — BO2 1-1 match refund (Bug #8)

1. Find a live BO2 match. Bet 20⚜ on player 1 from account A.
2. Watch match progress to 1-1.
3. **Expected after settle tick** : bet status = `REFUNDED`, `coinsUpdate` +20,
   `betResult` socket with `refunded: true`.
4. Observe the UI briefly shows "Perdu" before switching to "Remboursé"
   (Bug #8).

---

## 5. Phase D — Remediation plan

Atomic commits, one per bug, each independently revertable.
Order minimizes risk and gets the CRITICAL stuff out first.

| Order | Commit | Scope | Risk | Tests required |
|-------|--------|-------|------|----------------|
| 1 | `fix(coins): race-safe decrement in coinflip create/join` | [coinflipService.ts](backend/src/services/coinflipService.ts) | 🔴 Bug #1 partial | S1 + regression |
| 2 | `fix(coins): race-safe decrement in jackpot bet` | [jackpotService.ts](backend/src/services/jackpotService.ts) | 🔴 Bug #1 partial | Parallel jackpot bets |
| 3 | `fix(coins): race-safe decrement in roulette bet` | [rouletteService.ts](backend/src/services/rouletteService.ts) | 🔴 Bug #1 partial | Parallel roulette bets |
| 4 | `fix(coins): race-safe decrement in tip + withdrawal` | [users.ts](backend/src/routes/users.ts), [payments.ts](backend/src/routes/payments.ts) | 🔴 Bug #1 partial | S2 + parallel tip |
| 5 | `fix(coins): admin adjust wrapped in $transaction + race-safe + socket` | [admin.ts](backend/src/routes/admin.ts) | 🟠 Bugs #1 #6 | Manual admin adjust |
| 6 | `fix(affiliate): atomic claim via updateMany + socket` | [affiliate.ts](backend/src/routes/affiliate.ts) | 🔴 Bug #2 | S3 |
| 7 | `fix(affiliate): netLossBalance as atomic increment` | [affiliateService.ts](backend/src/services/affiliateService.ts) | 🟠 Bug #3 | Concurrent bet resolves on referred user |
| 8 | `fix(payments): emit coinsUpdate after withdraw debit + error refund` | [payments.ts](backend/src/routes/payments.ts) | 🟠 Bug #5 | S2 |
| 9 | `fix(jackpot): run affiliate revshare on resumed SPINNING rounds` | [jackpotService.ts](backend/src/services/jackpotService.ts) | 🟡 Bug #7 | S5 |
| 10 | `feat(ledger): add Transaction rows for bet flows` | [betService.ts](backend/src/services/betService.ts) | 🟠 Bug #4 | Q2 should narrow |
| 11 | `feat(ledger): add Transaction rows for coinflip / jackpot / roulette / tip / affiliate / admin` | 5 files | 🟠 Bug #4 | Q2 should near-zero |
| 12 | `fix(bet): unify refund socket event as status='REFUNDED'` | [betService.ts](backend/src/services/betService.ts) + 2 frontend | 🟡 Bug #8 | S7 |
| 13 | `fix(startup): wrap dedup refund in $transaction + emit socket` | [admin.ts](backend/src/routes/admin.ts), [index.ts](backend/src/index.ts) | 🟢 Bug #9 | Manual dedup test |

Out of scope (for a later audit pass) :
- Revenue reconciliation vs. OxaPay deposits (part of admin finance audit).
- Idempotency keys on every coin-moving endpoint (currently only deposits
  are idempotent via the `creditPaidDeposit` guard).
- Budget-side cost analysis for rain / jackpot (already covered by admin
  finance dashboard).

---

## 6. What's next

Awaiting from you :
1. **Run the 7 SQL queries from Phase B** in Supabase — paste results here.
2. **Execute S1–S3** manual scenarios in a staging / test environment to
   confirm Bug #1 and Bug #2 are exploitable *today* (makes the priority
   unambiguous before we start fixing).
3. Then I'll open commits #1 → #13 in order. Each commit ships independently
   with a short description + test plan.
