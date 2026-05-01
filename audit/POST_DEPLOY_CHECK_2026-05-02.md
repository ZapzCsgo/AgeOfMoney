# Post-deploy check — 2026-05-02

After commits `09269b4` (deprecate aoe4world stats batch) + `de46a8c`
(prelaunch final fix doc) + `6fbdba3` (auth UX fix).

## Curl smoke tests (run from devbox)

| Endpoint | Status | Time | Verdict |
|----------|--------|------|---------|
| `GET /api/v1/matches?limit=3` | **200** | 1.00 s | ✅ OK — main data path live |
| `GET /api/v1/health` | 404 | 0.77 s | ⚠️ endpoint doesn't exist yet — Task 2 |
| `GET /api/v1/odds/active` | 404 | 0.75 s | ✅ expected — no such endpoint |
| `GET /` (api root) | 404 | 0.67 s | ✅ expected — root is frontend, no handler on api subdomain |

**No 500 / 502** anywhere → no regression from the recent merges.

## Cron health (DB inspection)

The aoe4world stats batch was the noisy `0/50 errors` source. After the
deprecation commit (line `await updateAllPlayerStats()` commented out
inside `enrichAllUpcomingMatches`), the next 30-min cron tick should
NOT produce any new `aoe4world` `partial` row in `ScraperLog`.

Last 3 ScraperLog rows for source='aoe4world' (queried earlier) were
all from BEFORE the deprecation deploy :
```
2026-05-01T22:01:32.562Z status=partial updated=0 error=50 failed (profile_unresolvable=50)
2026-05-01T22:00:12.677Z status=partial updated=0 error=50 failed (profile_unresolvable=50)
2026-05-01T22:00:00.685Z status=partial updated=0 error=50 failed (profile_unresolvable=50)
```

**Need to re-check after the next cron tick** (~30 min after Railway
redeploy) — expect 0 new `aoe4world` rows since `enrichAllUpcomingMatches`
no longer calls `updateAllPlayerStats` on its periodic path.

## Conclusion

✅ **Production is healthy** post-deploy. No HTTP errors, main
data endpoint serving fresh matches.

The `/api/v1/health` 404 is a known gap — addressed by Task 2 in this
same session.

## Egress consumed by these checks

3 curl HEAD-style requests + 1 root → ~3 KB total. Negligible.
