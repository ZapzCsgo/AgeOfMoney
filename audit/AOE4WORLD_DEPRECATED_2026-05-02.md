# aoe4world player stats batch — DEPRECATED 2026-05-02

## Decision

We disable the **periodic batch update of player stats from aoe4world.com**.

Reasoning :
- aoe4world covers only **AoE4 ranked players** (those with a competitive
  ladder profile).
- Our 535-player base is multi-game (AoE4, AoE2, AoE3, AoM, AoE1) — the
  pros AoE2 we track (Chim Sẻ Đi Nắng, TheViper, Hera, etc.) have **no
  aoe4world profile**. ~70 % of the base lacks an aoe4worldId.
- Result : the 30-min `enrichAllUpcomingMatches` cron's first action
  `updateAllPlayerStats()` was returning **0/50 success rate** since
  the launch — every batch's top-50 was dominated by non-AoE4 players →
  100 % `profile_unresolvable`.
- Even when it works, the data is **irrelevant for an esports betting
  platform** : ranked ladder ELO and casual ranked stats don't predict
  tournament BO5 outcomes. What matters is :
  1. Tournament/match-officiel performance (collected via Liquipedia)
  2. H2H between specific players (collected via Liquipedia + tracked
     match results)
  3. Recent form in competitive (collected via Liquipedia)

## Ce qu'on désactive

- `enrichAllUpcomingMatches()` n'appelle plus `updateAllPlayerStats()` au
  début. La ligne est commentée avec un pointeur vers ce fichier.
- Conséquence directe : plus de "0 updated, 50 errors" toutes les 30 min
  dans les logs Railway. Plus de pollution.

## Ce qu'on garde de aoe4world (intact, toujours utile)

| Feature | Fichier:ligne | Pourquoi on garde |
|---------|---------------|-------------------|
| `scrapeAoe4WorldTournaments` (cron 15min) | `aoe4worldTournamentScraper.ts` | aoe4world maintient un calendrier propre des tournois S/A tier — meilleur que parser Liquipedia pour la liste des events |
| `buildProPlayerSet` | `aoe4worldScraper.ts:?` | Renvoie le set de profile_ids des pros connus (~156). Utilisé par `enrichMatchWithH2H` pour pondérer les opp-strength + par admin pour la liste de pros. Cheap call. |
| `getH2H` (via `enrichMatchWithH2H`) | `aoe4worldScraper.ts:782` | **Priority 3 fallback only** — exécuté UNIQUEMENT pour les paires de joueurs qui ont déjà un aoe4worldId stocké en DB (les ~150 AoE4 pros). Pas de tentative pour les 385 sans ID. |
| `enrichAllUpcomingMatches` (cron 30min) | `cron/jobs.ts:56` | KEEP — la fonction tourne toujours, c'est juste sa première étape (batch update stats) qui est désactivée. Le reste (per-match H2H enrichment + odds recalc) reste actif. |
| Admin manual trigger pour `updateAllPlayerStats` | `admin.ts:382` | KEEP — un admin peut toujours déclencher manuellement via `POST /api/v1/admin/scrapers/run` body `{ "source": "aoe4world" }` si besoin de rafraîchir un sous-ensemble. |

## Comment réactiver si on change d'avis

Dans `backend/src/scrapers/aoe4worldScraper.ts`, fonction `enrichAllUpcomingMatches`,
décommenter la ligne :
```ts
// await updateAllPlayerStats();
```
Ne PAS supprimer le filtre `where: { game: 'AoE4' }` ajouté en commit `48e2fd4`
(évite les profile_unresolvable sur les non-AoE4 players).

Si on veut vraiment relancer le batch sur tous les jeux, il faudrait :
1. Ajouter une source par jeu (aoe2.net pour AoE2, aoe3insights pour AoE3, etc.)
2. OU se contenter de Liquipedia comme source unique cross-game (déjà le cas
   pour la classification + tier + matchs)

## Sources de data alternatives qu'on utilise (effectivement)

| Source | Couverture | Cron |
|--------|-----------|------|
| Liquipedia upcoming matches (4 wikis) | AoE4, AoE2, AoE3, AoM | 15 min |
| Liquipedia live scorer (wikitext per-match) | tous | 30 s adaptive |
| Liquipedia player history seeder | tous | manual trigger via admin |
| AoE Events Calendar (ageofempires.com) | tous | 15 min |
| aoe4world tournament discovery | AoE4 only | 15 min — KEEP |
| aoe4world H2H Priority 3 fallback | AoE4 pairs avec aoe4worldId | per-match enrichment — KEEP |

## Commit

`<hash à insérer>` `feat(enrich): deprecate aoe4world player stats batch update`

## Métrique avant / après attendue

| Métrique | Avant | Après |
|----------|-------|-------|
| ScraperLog `aoe4world` rows / heure | 2 (toutes les 30 min) | 0 |
| Lignes `Player stats update complete: 0 updated, 50 errors` / heure | 2 | 0 |
| Lignes `[aoe4world] Failure example (profile_unresolvable): ...` / heure | ~2 | 0 |
| Lignes `[aoe4world] ALERT — batch success rate 0%` / heure | 2 | 0 |
| Charge réseau aoe4world (50 GET /players + 50 GET /search par batch) | ~200 req / heure | 0 |
| `enrichMatchWithH2H` per-match calls (Priority 3 fallback) | inchangé | inchangé |
| Tournament discovery `scrapeAoe4WorldTournaments` | inchangé | inchangé |
