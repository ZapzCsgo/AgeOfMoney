# Soft launch — final checklist

**Status target :** AgeOfMoney goes public on Reddit / Twitter / Discord
to start drawing real users. Validate everything below before posting.

---

## Pre-launch — must be green before announcing

### Production health
- [ ] `curl https://api.ageof.money/api/v1/health` returns `status: "ok"`
- [ ] `checks.database = "ok"` and `checks.scheduler = "ok"`
- [ ] `matches_active > 0` (means scrapers are populating data)
- [ ] `version` matches the latest commit on master (`git log -1 --format=%h`)
- [ ] `curl https://api.ageof.money/api/v1/matches?limit=3` → 200, < 2s

### Security gates
- [ ] Supabase password rotated (rotated by Matteo in parallel)
- [ ] Railway env has the rotated password (Settings → Variables)
- [ ] OWNER_USER_ID set in Railway env (per audit/OWNER_PROMOTION_GUIDE.md)
- [ ] Owner promotion script run + JWT refreshed
- [ ] Owner-only endpoint test : `curl -H "Authorization: Bearer $TOKEN"
      https://api.ageof.money/api/v1/admin/redeem-codes` returns 200
- [ ] **Without** auth header : same endpoint returns 401, not 200/500
- [ ] First test redeem code minted and redeemed end-to-end by Matteo
      (code → wallet modal → coin shows in `redeemLockedBalance`)

### Frontend visual checks
- [ ] Page 404 displays "DEFEAT" correctly (HTML overlay), no Gemini
      watermark visible bottom-right (CSS mask covers it)
- [ ] Wallet modal shows the new Redeem section with input + history toggle
- [ ] `https://ageof.money` loads without console errors
- [ ] `https://ageof.money/maintenance` accessible (just to confirm
      ErrorPage component still renders correctly)

### Scrapers + data
- [ ] At least 5 UPCOMING matches visible on the home page
- [ ] At least 1 LIVE match somewhere in the queue (or one started recently)
- [ ] At least 3 tournaments shown in "Prochains Tournois" section

---

## Launch sequence (staggered T+0 → T+24h)

The staggering is deliberate — gives Matteo time to react to each
channel's signal before the next post lands.

### T+0 : Discord communautaires AoE (priority 1)
- [ ] Post in main AoE Discord servers (#general or #share-your-content)
- [ ] Include : (1) a short pitch ("free coins to bet on AoE pro matches"),
      (2) the LAUNCH50 / DISCORD10 codes, (3) the URL, (4) a screenshot
- [ ] Stay online for the next 60 min to answer questions in DMs

### T+15 min : Twitter / X
- [ ] Tweet with a promo image + the LAUNCH50 code
- [ ] Hashtags : `#aoe4 #aoe2 #ageofempires #esports #esportsbetting
      #aoe #competitive #pro #tournament #liquipedia`
- [ ] Tag the official AoE accounts where appropriate
- [ ] Reply to anyone who quote-tweets within the hour

### T+45 min : Reddit r/aoe4
- [ ] Long-form post (NOT a link drop). Open with personal context :
      "I built this because…"
- [ ] Title : something like "I built a free betting platform for AoE
      pro matches — looking for early testers (LAUNCH50 = 50 free coins)"
- [ ] Body : explain wagering, that codes need 2× wagering before
      withdraw (so users don't feel scammed when the bonus locks)
- [ ] Reply to every comment in the first 2 hours

### T+24h : Reddit r/aoe2
- [ ] Adapted post with AoE2-specific framing — mention you've also got
      Liquipedia AoE2 wikis pumping data into the platform
- [ ] Maybe rotate the code to LAUNCH50AOE2 (track conversion separately)

### T+24h : Reddit r/AOEIV (smaller sub, less moderation, easier early
                          traction)
- [ ] Same long-form approach, AoE4 framing again

---

## Post-launch monitoring — first 6 hours

### Logs (Railway dashboard)
- [ ] Watch the deploy logs for any 5xx errors
- [ ] Specifically watch for `[Migration:redeem]` log entries on first
      boot — should see "✅ Schema applied successfully" then no more
- [ ] Watch for `[Security] Non-owner tried owner-gated route` — that's
      normal probing, not an alarm unless it's a flood from one IP

### Database (Supabase SQL editor — run every 30 min)
```sql
-- Signups in the last hour
SELECT COUNT(*) AS new_signups
FROM "User" WHERE "createdAt" > NOW() - INTERVAL '1 hour';

-- Deposits + total $ in the last hour
SELECT COUNT(*) AS deposits,
       SUM("amount")/100.0 AS usd_value
FROM "Transaction"
WHERE type = 'deposit'
  AND status = 'completed'
  AND "createdAt" > NOW() - INTERVAL '1 hour';

-- Bets placed in the last hour
SELECT COUNT(*) AS bets,
       SUM("amount") AS coins_wagered
FROM "Bet"
WHERE "createdAt" > NOW() - INTERVAL '1 hour';

-- Redeem code activity (the launch metric)
SELECT
  rc.code,
  COUNT(rcr.id) AS redemptions,
  SUM(rcr.amount) AS coins_distributed,
  SUM(CASE WHEN rcr.unlocked THEN 1 ELSE 0 END) AS unlocked_count
FROM "RedeemCode" rc
LEFT JOIN "RedeemCodeRedemption" rcr ON rcr."codeId" = rc.id
GROUP BY rc.id, rc.code
ORDER BY redemptions DESC;
```

### Comments (every 15 min for the first 2 h, then hourly)
- [ ] Reply to ALL comments within 60 min — silent posts die fast
- [ ] If someone reports a bug : screenshot it, file in your tracker, fix
      it within the hour or surface a workaround

---

## Rollback plan if catastrophe

### Code rollback (5 min)
```bash
# revert the merge commit ; Railway redeploys old code automatically
git revert -m 1 5ae4885  # merge commit
git push origin master
```

### Schema rollback (manual, only if data is being corrupted)
The redeem migration is purely additive. Worst case scenario : the new
tables exist but are empty. You can leave them in place safely, or drop
them :
```sql
DROP TABLE IF EXISTS "RedeemCodeRedemption" CASCADE;
DROP TABLE IF EXISTS "RedeemCode" CASCADE;
ALTER TABLE "User"
  DROP COLUMN IF EXISTS "redeemLockedBalance",
  DROP COLUMN IF EXISTS "totalWageringProgress";
```

### Communication
If anything breaks during launch, be transparent in Discord :
> "Hey folks — we hit a small issue with X. Investigating now, expect a
>  fix within Y minutes. Will post when resolved."

Don't pretend nothing happened. Users respect transparency more than
silence.

---

## Backup tag for full revert

`backup-pre-redeem-merge-20260502-1114` — the master HEAD just before
the redeem feature merged in. To full-revert (loses the bundled 404
polish too) :
```bash
git reset --hard backup-pre-redeem-merge-20260502-1114
git push origin master --force-with-lease  # WARNING : force push
```

Only use the full revert if the targeted `git revert -m 1 <merge>` above
isn't enough. Force push to master should be a last resort.
