# Egress tracking — overnight session 2 resume (2026-05-02)

Mesures par étape via la connexion pooler `aws-1-eu-central-1.pooler.supabase.com:6543`.
Les estimations sont conservatrices (taille payload Prisma + protocol overhead × 1.2 pour le binaire postgres).

| Phase | Operation | Rows fetched | JSON size on disk | Wire egress estimated |
|-------|-----------|---------------|-------------------|------------------------|
| 0 | DB ping `SELECT 1` ×~14 (region probe) | 1 each, mostly errors | n/a | <50 KB total |
| 0 | `players.count + match.count + pmr.count` smoke test | 3 numeric scalars | ~100 B | <1 KB |
| 2 | snapshot-data.ts (PMR batches + Match include) | 24 726 PMR + 251 Match | 3.9 MB JSON | **~5-6 MB** (one-shot) |
| 3 | run-all.ts filter=21 originals | 0 (reads .snapshot.json) | n/a | **0 B** |
| 6 | run-all.ts (36 variants) | 0 (snapshot reuse) | n/a | **0 B** |
| 6 | v36 exact-score MC | 0 (snapshot reuse) | n/a | **0 B** |
| 6.5 | analyze-exact-score-calibration | 0 | n/a | **0 B** |
| 7 | cleanup-team-players DRY-RUN | 1 Player.findMany + 1 Match.findMany | <10 KB | <15 KB |

**Total egress consumed this session : ~6 MB**.

For context : Supabase Pro quota = 250 GB/month. Cette session est largement
sous le seuil. Les phases lourdes (variants × 36, calibration, exact-score)
sont **toutes offline** car elles consomment le snapshot local — pas de
hit DB répété.

## Snapshot reuse pattern

Tous les scripts d'analyse partagent le même `.snapshot.json`. Le snapshot
est une opération one-shot que l'on relance manuellement (pas de cron). Il
est gitignored donc chaque dev/CI doit le re-prendre.

Pour le moment, le snapshot a été pris une fois, et 5 scripts différents
l'ont utilisé sans aucune nouvelle requête à Supabase. C'est exactement le
pattern visé par les contraintes egress du prompt.
