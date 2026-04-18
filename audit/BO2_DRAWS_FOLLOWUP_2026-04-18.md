# BO2 odds follow-up — 2026-04-18

## TL;DR

Le fix de [cron/jobs.ts:306-322](../backend/src/cron/jobs.ts#L306-L322) sur le
10-min fast recalc est **correct** et effectivement déployé. Mais un **deuxième
path, invisible dans l'audit initial, continue à écraser silencieusement**
`odds1/odds2` sans toucher `oddsDraw` → la row reste internement incohérente
jusqu'au prochain fast-recalc (et même ensuite, si le path cassé retourne).

**Cause racine** : `enrichMatchWithH2H` (30-min cron + enrichissement au scrape)
appelait `calculateOddsFromPlayers`, une signature legacy qui :
1. ne prend pas `format` en paramètre
2. retourne `{ odds1, odds2 }` uniquement — pas d'`oddsDraw`
3. était patchée avec `'oddsDraw' in newOdds ? {...} : {}` — mais cette
   check est **toujours false** vu la signature de retour, donc `oddsDraw`
   n'était jamais mis à jour.

**Résultat pour Match 2 (HeHe vs U98)** :
- 10-min fast recalc écrit `odds1=3.92, odds2=3.38, oddsDraw=14.20` (cohérent, 10% overround)
- 30-min enrichissement complet écrit `odds1=3.92, odds2=3.38` (2-way, 6% overround) et **laisse `oddsDraw=14.20`**
- Résultat en DB : Σ(1/odds) = 0.621 → **arbitrage garanti**

Même cause pour le bouton admin `POST /scrapers/run { source: 'enrich' }`.

Fix appliqué (commits à venir) : les deux path legacy utilisent maintenant
`calculateOddsV2` avec `format` et `p*Records` complets, comme le fast recalc.

---

## 1. Diagnostic précis — pourquoi Match 2 reste à oddsDraw=14.20

### Flow des crons (cf. [backend/src/cron/jobs.ts](../backend/src/cron/jobs.ts))

```
T+0    : scrape Liquipedia → crée/update matchs
T+0    : syncAoeEventCalendar
T+0    : enrichAllUpcomingMatches()
         └─ enrichMatchWithH2H(m.id)       ← BUG : legacy path
            └─ calculateOddsFromPlayers()   ← PAS de format, PAS d'oddsDraw
               └─ prisma.match.update({ odds1, odds2 })    ← oddsDraw reste stale
T+10m  : recalcActiveMatchOdds()            ← OK : V2 + format
T+20m  : idem
T+30m  : syncAoeEventCalendar + enrichAllUpcomingMatches() → bug re-frappe
T+40m  : recalcActiveMatchOdds()
...
```

Entre deux fast-recalc (10min), le slow enrich peut passer et **écraser les
`odds1/odds2` en 2-way margin**, laissant `oddsDraw` stale. La row est
corrompue pendant ~10min max avant que le fast recalc ne recompute.

Selon le timing, un utilisateur qui scroll la page "Matchs" à T+0 (juste après
enrichAllUpcomingMatches) peut tomber sur une row avec arbitrage.

### Traces attendues en logs prod

- `[Enrich] Match <id>: <p1> vs <p2> H2H=X → odds 3.92 / 3.38`
  (log de [aoe4worldScraper.ts:744-748](../backend/src/scrapers/aoe4worldScraper.ts#L744-L748)
  — pas d'oddsDraw dans le log, confirmant que le legacy path a bien tourné)
- `[FastRecalc] Recalculated odds for N active matches`
  (cron log — doit venir APRÈS le enrich pour re-corriger)

### `match.updatedAt` bouge-t-il ?

Oui — les deux path font `prisma.match.update`, donc `updatedAt` est bumped
même quand `oddsDraw` reste stale. Checker `updatedAt` ne permet pas de
distinguer les deux path. Ce qu'il faut regarder : si `odds1 * oddsDraw * odds2`
donne un overround < 1, c'est que le path legacy a gagné la course.

---

## 2. Fix appliqué

### Path 1 — `enrichMatchWithH2H` (le 30-min cron, principal coupable)
[backend/src/scrapers/aoe4worldScraper.ts:702-745](../backend/src/scrapers/aoe4worldScraper.ts#L702-L745)

Remplace :
```ts
const { calculateOddsFromPlayers } = await import('../services/oddsEngine');
const newOdds = calculateOddsFromPlayers(p1, p2, h2hRecent);
await prisma.match.update({
  data: { odds1, odds2, ...('oddsDraw' in newOdds ? {...} : {}) },  // toujours {} !
});
```

Par le même pattern que le fast recalc : charge `PlayerMatchRecord`,
appelle `calculateOddsV2({ format: match.format, matchTier, ... })`,
et **écrit toujours `oddsDraw` explicitement** (number pour BO2/BO4, null sinon).

### Path 2 — `POST /admin/scrapers/run { source: 'enrich' }`
[backend/src/routes/admin.ts:308-357](../backend/src/routes/admin.ts#L308-L357)

Même migration. Le bouton admin "Enrich" déclenchait exactement la même bug.

### Path 3 — `scripts/enrich-standalone.ts` (laissé)

Non utilisé en prod (script one-shot dev). Le fix est mineur et peut attendre.
Si quelqu'un le lance par inadvertance après avoir populé des BO2, il
re-créera le même bug localement. À migrer dans un prochain patch.

---

## 3. Calibration du modèle — P(1-1) en BO2

Même après le fix code, reste une question de **calibration statistique** : le
modèle binomial sur-prédit les draws ?

### Prédictions du modèle pur (vérifiées localement via
[backend/scripts/test-odds-bo2.ts](../backend/scripts/test-odds-bo2.ts))

| P(série gagnante) | p/game backsolvé via BO3 | P(1-1) prédit |
|-------------------|--------------------------|---------------|
| 0.50              | 0.500                    | **0.500**     |
| 0.60              | 0.567                    | **0.491**     |
| 0.65              | 0.601                    | **0.479**     |
| 0.70              | 0.637                    | **0.463**     |
| 0.80              | 0.713                    | **0.409**     |
| 0.85              | 0.756                    | **0.369**     |

**Interprétation** :
- Le modèle clamp `probDraw ∈ [0.05, 0.60]` (ligne 410 de `oddsEngine.ts`).
- Pour Truy Mệnh vs Không Được Khóc (prob1≈0.63), prédiction = 48% draw → prob1/prob2 post-redistribution ≈ 0.27/0.25 → odds1=3.37 / odds2=3.92 / oddsDraw=1.82 avec marge 10%.
- Les cotes prod observées (2.69 / 1.90 / 4.97) ne matchent **PAS** ces prédictions. Donc **même Match 1 n'a pas été calculé par le path V2 récent** — il a dû être écrasé par un path 2-way puis re-mergé partiellement.

### Empirique — à valider contre la DB Supabase prod

Script prêt : [backend/scripts/empirical-bo2-draws.ts](../backend/scripts/empirical-bo2-draws.ts).
Il dedupe les `PlayerMatchRecord` (chaque BO2 est stocké 2× — une fois par
joueur) puis compte les distributions de score (`2-0` / `1-1` / `0-2`) par
tier et par game.

**Comment le lancer** (direct URL 5432 non joignable depuis machine dev —
utiliser le pooler Supabase) :

```bash
# Dans Supabase Dashboard : Project Settings → Database → Connection Pooling → URI
DATABASE_URL="postgresql://postgres.xhusoizxbjkybcafvuss:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:6543/postgres?pgbouncer=true" \
  npx tsx scripts/empirical-bo2-draws.ts
```

### Recommandation conditionnelle

- Si **empirique ≈ 40-50%** → modèle déjà bien calibré, laisser en l'état.
  Les "48% draw" choquent visuellement mais sont réalistes pour deux joueurs
  proches en niveau sur 2 games. Les BO2 compétitifs CSGO/LoL ont 30-45% de
  draws selon les formats.
- Si **empirique ≈ 25-35%** → appliquer un coefficient de shrinkage dans
  [oddsEngine.ts:407](../backend/src/services/oddsEngine.ts#L407) :
  ```ts
  probDraw = calculateDrawProbability(pPerGame, boNum) * SHRINKAGE_BO2;
  // puis clamp standard
  ```
  Ratio empirique/prédit = shrinkage à appliquer.
- Si **empirique ≈ 10-20%** → il y a un bug structurel (scores mal parsés,
  ou confusion BO2/BO3). Auditer d'abord la source des `PlayerMatchRecord`.

### Alternative : passer au modèle empirique direct

Plus robuste long terme. On stocke en DB, par paire de tier, la distribution
empirique des scores BO2 observés, et on l'utilise comme prior Bayésien
mélangé avec la prédiction binomiale selon le nombre d'échantillons. C'est
le même pattern que `buildBlendedDistribution` déjà utilisé pour BO3+.

Effort : ~2h. Recommandé si l'écart empirique/binomial est > 15%.

---

## 4. Actions immédiates à prendre

- [x] Fix appliqué : `enrichMatchWithH2H` et `admin.ts` utilisent V2 + format
- [x] Script empirique écrit : `scripts/empirical-bo2-draws.ts`
- [ ] **Tu fais** : push master avec le fix, attends 30min qu'un full enrich
  tourne (ou trigger manuel), puis check Match 2 en DB :
  ```sql
  SELECT id, odds1, "oddsDraw", odds2,
         (1.0/odds1 + 1.0/"oddsDraw" + 1.0/odds2) AS overround
  FROM "Match"
  WHERE status='UPCOMING' AND format='BO2';
  ```
  Tous les `overround` doivent être dans [1.08, 1.12].
- [ ] **Tu fais** (si tu veux l'analyse empirique) : récupère le pooler URL
  Supabase, lance `scripts/empirical-bo2-draws.ts`, me partage l'output,
  je tune le shrinkage si besoin.
- [ ] Après déploiement du fix : audit sanity
  ```bash
  npx tsx scripts/audit-odds-coherence.ts
  ```
  Doit retourner 0 P0.

## 5. Non-touché

- **Paris PENDING** : laissés aux cotes enregistrées (`oddsAtBet`), comme demandé.
  Personne n'est lésé. Si des utilisateurs ont exploité l'arbitrage Match 2
  avant le fix, leurs paris seront honorés aux cotes prises — c'est la règle.
- **`scripts/enrich-standalone.ts`** : bug similaire mais c'est un script
  dev manuel, pas de cron. Patch à faire dans le même esprit à la prochaine
  passe.
