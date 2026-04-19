# Scraper coverage audit (2026-04-19)

**TL;DR** : 76 joueurs AoE4 en DB seulement. **15 709 PMR rows (67 %) pointent
vers des opponents qui n'existent pas comme Player** — dont Hera (#1 mondial :
186 PMR orphelines). Root cause n°1 : les scrapers d'historique ne créent pas
de Player row pour les opponents rencontrés, ils se contentent de stocker le
nom. Un fix ~2h ciblé peut doubler la couverture. Plan de 5 actions priorisé
par ROI à la fin. Phase audit only — aucun code modifié.

---

## 1. Snapshot DB actuel

### 1.1 Players

| | Count |
|---|---|
| Total Players (tous jeux) | 126 |
| AoE4 | **76** |
| AoE2 | 50 |
| PlayerRating avec ≥ 10 games (après rebuild Phase 4) | 113 |

### 1.2 Matchs + records

| | Count |
|---|---|
| `Match` COMPLETED total | 142 (AoE2 : 87, AoE4 : 55) |
| `PlayerMatchRecord` total | **23 509** |
| PMR avec `opponentId` = null (**orphelines**) | ~15 709 (67 %) |
| Distinct orphan opponent names | **3 520** |

### 1.3 PMR par tier

| Tier | Count |
|---|---|
| B | 6 106 |
| C | 4 643 |
| Qualifier | 4 222 |
| A | 3 842 |
| S | 3 766 |
| Misc | 930 |

### 1.4 Tournaments (34 total)

| Game | Tier | Count |
|---|---|---|
| AoE4 | S | 7 |
| AoE4 | A | 5 |
| AoE4 | B | 1 |
| AoE4 | C | 5 |
| AoE2 | S | 12 |
| AoE2 | A | 2 |
| AoE2 | B | 2 |

**Duplicates détectés** : "Red Bull Wololo: Londinium" existe **3 fois** pour
AoE4 (variantes de nom : `Red Bull Wololo: Londinium`, `… - AoE IV`,
`… Age of Empires IV`). Mineur mais pollue les stats.

### 1.5 Top 20 AoE4 Players par volume PMR

```
VortiX                  541    Uzzi                    360
Chim Sẻ Đi Nắng         488    U98                     336
1puppypaw               488    SAS                     301
LucifroN                479    Bee                     301
MarineLorD              447    Truy Mệnh               288
Running                 427    WaRRioR                 288
CoRe                    426    Numudan                 287
LaSh                    411    Elyona                  265
Myriad                  398    Fedex                   260
Valdemar                385    LobodeLaNieve           257
```

**Anomalie** : Beastyqt (#1 Glicko après rebuild Phase 4) n'a que **4 PMR**.
Il doit sa position à son historique scrapé comme opponent des autres,
mais les PMR sous SON playerId sont quasi-vides — donc le scrape d'historique
ne l'a pas ciblé directement (alors que `enrichPlayerWithAI` devrait).

---

## 2. Inventaire des scrapers

| Scraper | Rôle | Filtre tier | Déclencheur |
|---|---|---|---|
| [aoeEventCalendarScraper](../backend/src/scrapers/aoeEventCalendarScraper.ts) | Sync calendrier officiel AoE (tous jeux, POST admin-ajax) | aucun au scrape, tier guessé via name puis confirmé par LP infobox | cron 15 min |
| [liquipediaScraper](../backend/src/scrapers/liquipediaScraper.ts) (`scrapeUpcomingMatches`) | Parse `/Liquipedia:Upcoming_and_ongoing_matches` pour récup matchs individuels → crée Player + Match | **S/A uniquement** (`isTierAllowed` line 322) | cron 15 min |
| [aoe4worldTournamentScraper](../backend/src/scrapers/aoe4worldTournamentScraper.ts) | API aoe4world `/tournaments` → Tournament + participants → Players + Matchs | **S/A + 1v1 uniquement** (line 101) | cron 15 min |
| [aoe4worldScraper](../backend/src/scrapers/aoe4worldScraper.ts) | Enrichit matchs existants (stats aoe4world, custom RM record) | — | cron 30 min |
| [aiPlayerHistoryScraper](../backend/src/scrapers/aiPlayerHistoryScraper.ts) | Claude Opus scrape history d'un Player existant → PMR | — | déclenché par `enrichAllSparseH2H` (6h) |
| [liquipediaPlayerHistoryScraper](../backend/src/scrapers/liquipediaPlayerHistoryScraper.ts) | Parse `/Matches` subpage d'un Player existant → PMR | stocke tous tiers (S/A/B/C/Qualifier/Misc) | déclenché manuellement ou via admin |
| [aoe4worldPlayerHistorySeeder](../backend/src/scrapers/aoe4worldPlayerHistorySeeder.ts) | Bulk-seed history aoe4world pour Players existants | — | admin "seed-all" |
| [aiH2HScraper](../backend/src/scrapers/aiH2HScraper.ts) | AI H2H direct entre 2 Players existants | — | déclenché par `enrichAllSparseH2H` |

**Observation clé** : TOUS les scrapers "history" supposent que le Player
existe déjà. Aucun ne crée un Player à partir d'un nom découvert en
scrapant l'historique d'un autre.

---

## 3. Cross-ref : top AoE4 pros vs DB

Liste de référence de 42 top pros AoE4 connus (inclus tous les noms
explicitement cités par l'utilisateur : Hera, JiNoo, Huuh, Miracle, FitzBro,
Nicov4, Gooby, RecoN, PaladinAttack) :

**Présents (25/42, 59 %)** :
Beastyqt, MarineLorD, Wam01, 1puppypaw, VortiX, TaToH, Bee, LucifroN,
Chim Sẻ Đi Nắng, FreakinAndy, Kasva (AoE2), Ciskhan (AoE2), Lighty,
Classicpro, DuDuZhu, KingstoNe (AoE2), Scatterbrained, Valdemar, HeHe,
Numudan, Corvinus1, CoRe, Sebastian (AoE2), Nicov (AoE2), Villese (AoE2).

**Absents (17/42, 41 %)** :

| Nom | Commentaire | PMR orphelines (comme opponent) |
|---|---|---|
| **Hera** | #1 mondial AoE4 | **186** |
| **DeMu** | top 10 actif | **111** |
| **RecoN** | EU scene | **55** |
| **Rubenstock** | EU | 5 |
| JiNoo | Corée, top 10 | 0 (jamais vu) |
| Huuh | Vietnam, top 15 | 0 |
| Miracle | — | 0 |
| FitzBro | — | 0 |
| Nicov4 | — | 0 |
| Gooby | — | 0 |
| PaladinAttack | — | 0 |
| Stefan | EU | 0 |
| Dragonstar | présent en DB sous "The Dragonstar" | — (normalisation) |
| Lunatic, Survivalist, Cap, FluffyMelo | — | 0 |

### 3.1 Le fait marquant

**Hera a 186 PMR où il apparaît comme `opponentName`** (dans l'historique
scrapé de Beastyqt, MarineLorD, Wam01, etc. qui l'ont affronté). Mais il n'a
pas de Player row → pas de Glicko rating → pas utilisable pour les odds de
ses futurs matchs.

**Même chose** pour DeMu (111), RecoN (55), Rubenstock (5).

---

## 4. Top 40 opponents orphelins (≥ 20 PMR rows chacun)

Extract SQL :

```
Hera               186       loueMT           121       DeMu             111
LucifroN7           97       GL                96       Beasty            96
Gullyd3ck3l         94       kiljardi          92       Biry              90
Fox                 89    __claude_cache__     83       CAT               82
JorDan_AoE          80       DivineDFP         78       Suomi             75
Msn.dk              74       El_Matador        65       Margougou         64
MeomaikA            61       Valas             60       GiveUAnxiety      60
BiBi                59       RecoN             55       RoR               54
shiXo.#             54       WWP               53       Sobek             53
ISanych             53       Thái Bình         52       Daniel            52
Nam Sociu           51       Nahuel05          50       Leenock           50
SalzZ               48       DS                48       CsOH              48
VNA                 47       Dragevann         47       Ganji             47
TAG                 46
```

**Classification** :

- **Pros majeurs à récupérer** (13 noms) : Hera, DeMu, RecoN, Rubenstock,
  Suomi, JorDan_AoE (a Player "JorDan AoE"), Leenock, Fox, BiBi, MeomaikA,
  Margougou, Valas, El_Matador, Ganji.
- **Variantes de noms existants** (aliasing à faire, 4 noms) : Beasty
  (= Beastyqt, 96), LucifroN7 (= LucifroN, 97), shiXo.# (= ShiXo., 54),
  JorDan_AoE (= JorDan AoE, 80).
- **Clan tags à filtrer** (6+ noms) : GL (96), CAT (82), RoR (54), WWP (53),
  DS (48), TAG (46), VNA (47) — ce sont des préfixes de teams, pas des
  joueurs.
- **Bug sentinel** : `__claude_cache__` (83) ne devrait JAMAIS être stocké
  comme opponent. À filtrer explicitement dans les scrapers.
- **Inconnus** (restants) : farmers / joueurs régionaux. À seuiller par
  activité pour ne pas polluer.

---

## 5. Diagnostic : pourquoi Hera/DeMu/RecoN ne sont pas des Players ?

### 5.1 Root cause unique

Les 2 scrapers qui génèrent des PMR ([liquipediaPlayerHistoryScraper.ts:287-295](../backend/src/scrapers/liquipediaPlayerHistoryScraper.ts#L287) et [aiPlayerHistoryScraper.ts:158-176](../backend/src/scrapers/aiPlayerHistoryScraper.ts#L158)) font la même chose :

```ts
// On LOOK UP l'opponent existant…
const opponent = await prisma.player.findFirst({ where: { name: ... } });
await prisma.playerMatchRecord.upsert({
  create: {
    opponentName: m.opponentName,
    opponentId: opponent?.id ?? null,  // ← si absent, on stocke null
    ...
  }
});
```

**Ils ne créent JAMAIS un Player row à partir d'un nom d'opponent inconnu.**
Le fait que Hera apparaisse 186 fois n'aide pas — chaque mention est stockée
avec `opponentId = null` et le nom en texte libre. Du point de vue du reste
du système (rebuild Glicko, computeWinProbability, odds engine), ces 186
matchs sont invisibles car ils n'ont pas de playerId attachable côté Hera.

### 5.2 Facteurs aggravants

1. **Filtre S/A restrictif sur la discovery live** : les 2 scrapers qui
   découvrent des Players "sur le moment" (liquipediaScraper upcoming +
   aoe4worldTournamentScraper) ne regardent que S/A-tier 1v1. Les joueurs
   qui n'ont pas de match S/A planifié cette semaine ne rentrent pas en DB
   — même s'ils jouent 5 matchs B-tier / semaine.

2. **Pas de source "top players" pro-active** : Liquipedia a des pages
   `/Portal:Players/Age_of_Empires_IV` et `/Top_player_rankings` qu'on
   n'interroge jamais. Un one-shot seed manqué.

3. **Normalisation inexistante** : "Beasty" vs "Beastyqt", "LucifroN7" vs
   "LucifroN", "shiXo.#" vs "ShiXo.", "JorDan_AoE" vs "JorDan AoE", "The
   Dragonstar" vs "Dragonstar". `resolveOpponentId` a du partial matching
   mais rate ces cas car les différences sont trop petites (suffixe chiffre,
   underscore, trailing `#`).

4. **Sentinel leak** : `__claude_cache__` utilisé par `aiPlayerHistoryScraper`
   comme marqueur d'enrichissement a été stocké 83 fois comme opponent →
   probable bug de code (pas vérifié dans l'audit, mais filtrable facilement).

---

## 6. Plan de fix priorisé par ROI

### P0 — Upsert Player à partir des opponent names (gros ROI, ~2h)

**Problème attaqué** : 15 709 PMR orphelines, dont Hera (186), DeMu (111),
RecoN (55), Rubenstock (5), + ~150 autres noms avec ≥ 20 PMR.

**Fix** : dans `liquipediaPlayerHistoryScraper.ts:287` et
`aiPlayerHistoryScraper.ts:194`, remplacer le `findFirst` par un `upsert`
quand le nom passe des sanity checks :
- Skip si nom ∈ {`__claude_cache__`, clan tags courts type "GL" / "TAG"
  / "WWP" / "DS" / "RoR" / "VNA" / "CAT"}.
- Skip si longueur < 3 ou > 40.
- Skip si c'est du "pure team name" (regex existant utilisé pour filtrer
  WTL teams : `/^team\s+|esports?\s*[ab]?$/i`).
- Sinon : `prisma.player.upsert({ where: { liquipediaSlug: derived }, create: { name, liquipediaSlug, game, elo: 1500 } })`.
- Mettre à jour `opponentId` sur tous les PMR existants qui référencent ce
  nom (backfill).

**Effort** : ~2h (code + test + relancer rebuild-ratings).

**Impact estimé** :
- ~200-300 nouveaux Players (après filtre activity ≥ 10 matchs).
- Hera, DeMu, RecoN immédiatement ratables.
- PMR orphelines : 15 709 → ~3 000 (on garde les clan tags / noms rares
  filtrés).
- PlayerRating ≥ 10 games : 113 → **~280-350**.

### P1 — Seed from Liquipedia Top Players Portal (moyen ROI, ~3h)

**Problème attaqué** : P0 attrape seulement les opponents déjà vus. Un pro
comme JiNoo (0 PMR orphan car jamais scrapé comme opponent) reste invisible.

**Fix** : nouveau script `scripts/seed-top-pros.ts` qui :
1. Fetch `https://liquipedia.net/ageofempires/Portal:Players/Age_of_Empires_IV`
   (+ équivalents AoE2/3/M).
2. Parse la table "Active players" → liste de slugs Liquipedia.
3. `prisma.player.upsert` chaque slug avec game correct.
4. Trigger `scrapePlayerHistoryFromLiquipedia` sur chaque nouveau Player
   pour seed son historique.
5. Run rate-limit 8s/requête pour respecter LP (~15 min pour 100 pros).

**Effort** : ~3h (nouveau module + tests).

**Impact estimé** :
- +50-100 top pros actifs (dont JiNoo, Huuh, Miracle, FitzBro, etc.).
- Seed +500-2 000 PMR par joueur ajouté.
- Meilleure couverture à long terme (pas juste ceux qu'on voit en upcoming).

### P2 — Name normalization map (moyen ROI, ~1h)

**Problème attaqué** : Beasty/Beastyqt dédupliqués, LucifroN/LucifroN7
fusionnés, shiXo.# matché avec ShiXo..

**Fix** : une table `NameAlias` (nouvelle) OU une liste en dur dans le code
(~20 aliases manuels curés depuis le top-40 orphans) :

```ts
const ALIASES: Record<string, string> = {
  'beasty': 'beastyqt',
  'lucifron7': 'lucifron',
  'shixo.#': 'shixo.',
  'jordan_aoe': 'jordan aoe',
  'the dragonstar': 'dragonstar',
  // …
};
```

Appliquée dans `resolveOpponentId` avant le lookup.

**Effort** : ~1h.

**Impact estimé** : fusionne ~15-25 alias orphelins dans les Player existants,
récupère ~500-800 PMR sous le bon playerId.

### P3 — Relaxer filtre discovery S/A → S/A/B (petit ROI, ~30min)

**Problème attaqué** : B-tier tournaments génèrent du volume mais ne
créent pas de Players (puisque le scraper de discovery les skip). P0 couvre
indirectement via opponents, donc pas urgent.

**Fix** : dans `liquipediaScraper.ts:322` et
`aoe4worldTournamentScraper.ts:101` :

```ts
function isTierAllowed(tier: string): boolean {
  return tier === 'S' || tier === 'A' || tier === 'B';
  // Qualifier reste exclu (pas un tier "propre" sur la page upcoming)
}
```

**Garde-fou UI** : garder le filtre S/A côté frontend pour l'affichage des
paris (pas tout déballer d'un coup). L'impact est uniquement sur la discovery
des Players, pas sur ce que l'utilisateur voit.

**Effort** : 30 min (2 lignes + vérif tests).

**Impact estimé** : +10-30 Players "mid-tier actifs" par mois. Complément
naturel à P0.

### P4 — Filtrer `__claude_cache__` + clan tags (petit ROI, ~15min)

**Problème attaqué** : 83 PMR pollués par le sentinel, ~350 PMR sur des
clan tags qui ne sont pas des joueurs (GL, CAT, RoR, WWP, DS, TAG, VNA,
Msn.dk peut-être).

**Fix** : ajouter une blocklist `INVALID_OPPONENT_NAMES` dans les 2 scrapers
PMR + cleanup SQL one-shot pour purger les PMR existantes pointant sur ces
noms.

**Effort** : 15 min + 1 migration SQL.

**Impact estimé** : nettoie ~400 PMR poubelle. Zéro gain Player mais données
plus propres pour le rebuild.

---

## 7. Plan d'exécution ordonné

| # | Action | Effort | Nouveau AoE4 Players | PMR récupérées | Go-no-go |
|---|---|---|---|---|---|
| 1 | **P0** upsert opponents | 2h | **+100-200** | **+10-12k** | Go direct |
| 2 | **P4** filter sentinel + clan tags | 15 min | 0 | clean +400 | Go après P0 |
| 3 | **P2** alias map | 1h | dédup ~15-25 | +500-800 | Go après P0 |
| 4 | **P1** seed top pros portal | 3h | +50-100 | +5-20k | Go après P0 (dépendance : scrapePlayerHistoryFromLiquipedia fiabilisé) |
| 5 | **P3** relax tier filter | 30 min | +10-30 / mois | ongoing | Go en dernier (hors impact des autres) |

**Total effort** : ~7h coding + 30 min migrations + 1 rebuild complet.

---

## 8. Estimation d'impact sur le backtest Glicko

| Métrique | Actuel | Après P0 | Après P0+P1+P2 |
|---|---|---|---|
| AoE4 Players | 76 | **~180-250** | ~300-350 |
| AoE2 Players | 50 | ~60-80 | ~80-100 |
| PlayerRating ≥ 10g | 113 | **~250-300** | ~330-400 |
| PMR avec opponentId | ~7 800 | **~20 000** | ~22 000 |
| Matchs valides pour backtest (les 2 joueurs ont rating) | N=45 | **N=80-120** | N=120-180 |
| N pour re-backtester V2 avec stats fiables | ≥ 200 | encore insuffisant | atteint **si plus 4-6 semaines de matchs live** |

**Timeline estimée pour atteindre N=200 valid backtest** :

- Sans rien faire : ~3-5 mois (à 10-15 nouveaux matchs COMPLETED / semaine
  et ~50 % valides).
- Avec P0 seul : ~6-10 semaines (le stock de PMR historiques remonte N
  immédiatement d'environ +40-75 matchs, puis le flow hebdo accélère car
  plus de paires ont rating).
- Avec P0+P1 : **~3-5 semaines** (seed pros + historique → stock de valid
  predictions gonfle vite).

**Conclusion** : P0 + P1 combinés suffisent pour relancer un backtest Phase
2/4 crédible d'ici fin mai 2026. À ce moment-là, relancer
`backtest-phase3-diagnostic.ts` + décider flag V2 ON/OFF sur base empirique
robuste.

---

## 9. Règles respectées pour cet audit

- ✅ **Lecture seule** : aucun scraper modifié, aucun DB write hors du
  rebuild-ratings déjà fait en Phase 4.
- ✅ **Pas de bourrinage LP** : 3 WebFetch (tous rate-limités 429) + 1
  WebFetch aoe4world leaderboard (inutilisable car aliases in-game ≠ pro
  names). Liste de référence top pros basée sur connaissance publique +
  confirmation DB via SQL.
- ✅ **Pas d'implémentation** : uniquement un plan ordonné avec chiffres
  d'impact et efforts.

---

## 10. Question pour validation

Tu valides le plan P0 → P4 dans cet ordre, ou tu veux qu'on :
1. Commence par P1 (seed top pros) en premier pour avoir immédiatement
   Hera/JiNoo/Huuh, quitte à faire P0 après ?
2. Fait P0+P1 en parallèle (2 commits séparés sur master) ?
3. Revoir les TIER_WEIGHTS (ex: baisser S de 4→3) après avoir plus de data,
   plutôt que d'ajouter des joueurs ?

J'attends ton go avant de coder quoi que ce soit.

---

## Références code auditées

- [backend/src/scrapers/liquipediaScraper.ts:322](../backend/src/scrapers/liquipediaScraper.ts#L322) — filtre S/A upcoming
- [backend/src/scrapers/liquipediaScraper.ts:700-709](../backend/src/scrapers/liquipediaScraper.ts#L700) — Player upsert (seul chemin actuel de création)
- [backend/src/scrapers/liquipediaPlayerHistoryScraper.ts:287-329](../backend/src/scrapers/liquipediaPlayerHistoryScraper.ts#L287) — **point de fix P0**
- [backend/src/scrapers/aiPlayerHistoryScraper.ts:158-231](../backend/src/scrapers/aiPlayerHistoryScraper.ts#L158) — **point de fix P0 (bis)**
- [backend/src/scrapers/aoe4worldTournamentScraper.ts:101](../backend/src/scrapers/aoe4worldTournamentScraper.ts#L101) — filtre S/A API
- [backend/src/cron/jobs.ts](../backend/src/cron/jobs.ts) — pipeline cron scraper
