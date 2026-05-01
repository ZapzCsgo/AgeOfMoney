# cleanup-team-players DRY-RUN — 2026-05-02

Run via : `SKIP_SERVER=1 DATABASE_URL=<pooler> npx tsx scripts/cleanup-team-players.ts`

## Players matching the team pattern

Pattern : `/^team\s+|esports?\s*[ab]?$|\s+esports?$|esports?\s+[ab]$|\s+[AB]$/i`

| Name | Player ID | Matches involving them |
|------|-----------|-------------------------|
| Team Vitality | cmolrdcun000l133ripyoq7vo | 1 |
| Onimaru Esports | cmolrdcwo000m133r06k7qser | 1 |
| Uxmal Esports | cmnv8s0s7000jtalvo1oztmwc | 1 |
| Rulers of Rome B | cmnbzz6wj000b9ghswfgmblto | 2 |
| Team Venon Esports | cmnw905pf01zl13o9wf7xk3mk | 1 |
| Old School B | cmnuxus8y07vs106pjsc924vx | 1 |

**Total : 6 offender players, 7 historical matches.**

## Live/upcoming matches affected

**0** — all matches involving these players are already COMPLETED or
CANCELLED. No active bets to refund, no socket broadcasts needed.

## Recommendation for `--apply`

Since there are 0 live/upcoming matches, the `--apply` step would only
need to handle historical match Player FKs. Two paths :

1. **Skip `--apply` entirely** — historical matches with team-name "players"
   are not user-facing (the home page only shows UPCOMING/LIVE) and they
   don't pollute the odds engine for new matches because the team players
   have no PMR records. Cleanest "do nothing" option.

2. **`--apply --delete-players`** — drops the 6 player rows. This will
   FK-cascade fail because they're referenced by 7 Match rows. Either also
   delete those matches (data loss) OR null-out the player FKs (schema
   doesn't allow nullable yet). **Recommend NOT running this.**

3. **Keep the player rows but rename them** to surface the truth (e.g.
   "[TEAM] Team Vitality") so admins can spot them in the player table.
   Not implemented in the script.

## Recommended action

✅ **DO NOT run `--apply` tonight.** The fix is the regex `/i` flag (commit
`5b1843c`) which prevents future ingest. The 6 historical orphans are
harmless — they have 0 PMR records, 0 live matches, and don't surface
anywhere user-visible.

If the user wants to clean up later, the proper path is :
- Add `name` index + admin UI filter for these patterns
- One-shot SQL `DELETE FROM "Match" WHERE …` followed by
  `DELETE FROM "Player" WHERE …` after verifying no other FK refs

## Egress consumed by this run

~5 KB (single small `findMany` Player + a `findMany` Match WHERE OR(p1=, p2=)).
Negligible.
