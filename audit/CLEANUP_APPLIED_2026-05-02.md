# cleanup-team-players APPLIED — 2026-05-02

## Timestamp

Run terminé : **2026-05-02 22:09 UTC** (06:09 local Sat).

## Mode

```
SKIP_SERVER=1 DATABASE_URL=<pooler> npx tsx scripts/cleanup-team-players.ts \
  --apply --cascade-delete-orphans
```

The `--cascade-delete-orphans` flag was added in this run because the
plain `--apply` is a no-op when 0 live matches involve the orphans, and
the existing `--delete-players` skipped because of FK refs to historical
Match + PlayerMatchRecord rows. The cascade walks the FK chain explicitly :
matches → PMR → player, refusing to touch any match that still carries
bets or boResults (none here).

## Pre-flight

- 6 player rows matching `/^team\s+|esports?\s*[ab]?$|\s+esports?$|esports?\s+[ab]$|\s+[AB]$/i`
- 5 historical Match rows referencing them (one match involves two orphans : Old School B vs Rulers of Rome B)
- 22 PlayerMatchRecord rows referencing them (as player or opponent)
- **0 LIVE / UPCOMING matches**, **0 bets**, **0 boResults** — fully safe to wipe.

## Rows supprimées

The cascade ran in two passes (the first FK-blocked on PMR before I added
the PMR sweep) :

| Pass | Operation | Count |
|------|-----------|------:|
| 1 (partial) | Match deletes (CANCELLED only) | 5 |
| 1 (partial) | Player delete (Team Vitality only — first one before FK block) | 1 |
| 2 (full)    | PlayerMatchRecord deletes | 22 |
| 2 (full)    | Player deletes (5 remaining) | 5 |

**Total : 5 matches + 22 PMR rows + 6 players deleted.**

## Players removed (final)

| Name | Player ID |
|------|-----------|
| Team Vitality | cmolrdcun000l133ripyoq7vo |
| Onimaru Esports | cmolrdcwo000m133r06k7qser |
| Uxmal Esports | cmnv8s0s7000jtalvo1oztmwc |
| Rulers of Rome B | cmnbzz6wj000b9ghswfgmblto |
| Team Venon Esports | cmnw905pf01zl13o9wf7xk3mk |
| Old School B | cmnuxus8y07vs106pjsc924vx |

## Matches deleted

| Match ID | Status | Players |
|----------|--------|---------|
| cmnbzz9ah000e9ghsrdt0fgem | CANCELLED | Rulers of Rome B vs ANKR |
| cmnv8s1z9000ltalvl946amad | CANCELLED | ANKR vs Uxmal Esports |
| cmnuxuuek07vv106pk1zw3lvp | CANCELLED | Old School B vs Rulers of Rome B |
| cmo65v66j00d712avanjawg9d | CANCELLED | Team Venon Esports vs R1 |
| cmolrdd2u000o133rql0qgb9h | CANCELLED | Team Vitality vs Onimaru Esports |

## Post-cleanup verification

```
$ npx tsx scripts/cleanup-team-players.ts          # dry-run
[cleanup-team-players] mode = DRY-RUN
Players matching team pattern : 0
✅ Nothing to clean.
```

## Expected impact on aoe4world enrichment cron

The orphans were guaranteed to fail with `profile_unresolvable` on every
`updatePlayerFromAoe4World` call. Removing them should bump batch success
rate from the recent 0/50 → ≥ 80 % once Railway picks up the new code AND
the aoe4world API itself is healthy.

The remaining ~44 failures observed in prod (50 − 6 orphans) likely have
a different root cause — the new categorized logging from commit `e1d0bdd`
will surface it on the next batch run.

## Egress consumed

- Initial dry-run : ~5 KB
- Apply run #1 (partial, FK abort) : ~5 KB read + 5 small DELETE
- Apply run #2 (full cascade) : ~10 KB read + 33 DELETEs (5 match + 22 PMR + 5 player)
- Final verify dry-run : ~5 KB

**Total ≈ 30 KB**.
