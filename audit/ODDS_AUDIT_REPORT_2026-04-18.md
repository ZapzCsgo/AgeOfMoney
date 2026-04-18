# Audit Odds Engine — 2026-04-18

## Résumé exécutif

- **Status coherence** : ⚠️  — fix BO2 score-exact bien en place (commit `22c84f3`, vérifié `bets.ts:135-145`), mais `calculateDrawProbability` sur BO2 utilise un proxy de probabilité incorrect qui crée un **risque de free money** réel sur matchs déséquilibrés.
- **Status calibration** : ❌ — aucune validation empirique existante (Brier / log-loss), aucun test unitaire (`backend/tests/` vide, 0 fichier `.spec.ts` / `.test.ts`). Le modèle est déployé "à l'aveugle".
- **Bugs critiques trouvés** : 2 P0, 4 P1, 3 P2.
- **Dette technique bloquante** : absence totale de tests sur le moteur — toute modif du blending est un saut dans le vide.

---

## Free money risks

### FM-1 (P0) — `calculateDrawProbability(prob1, boNum)` sur-cote la draw en BO2 déséquilibré

**Où** : [oddsEngine.ts:115-124](backend/src/services/oddsEngine.ts#L115-L124) + appel [oddsEngine.ts:374](backend/src/services/oddsEngine.ts#L374).

**Problème** : la fonction applique `P(draw) = C(n, n/2) · p^(n/2) · (1-p)^(n/2)` en **traitant `prob1` comme la probabilité de gagner une game individuelle**. Or `prob1` sortant du blending (WR + H2H + form + tier) est la probabilité de **gagner la série**. Les `PlayerMatchRecord.won` stockent un flag de victoire de série ([liquipediaPlayerHistoryScraper.ts:311](backend/src/scrapers/liquipediaPlayerHistoryScraper.ts#L311), [aoe4worldPlayerHistorySeeder.ts:157](backend/src/scrapers/aoe4worldPlayerHistorySeeder.ts#L157) — `won = playerWins > opponentWins`), et les BO2 qui se terminent 1-1 ne sont **jamais** loggés ([liquipediaLiveScorer.ts:881-892](backend/src/services/liquipediaLiveScorer.ts#L881-L892) : le `distributeDrawPayout` branch ne crée pas de `PlayerMatchRecord`).

**Conséquence mesurée** — matchup 85/15 en BO2 :

| Grandeur              | Valeur codée (prob1 = 0.85) | Valeur vraie (p_per_game ≈ 0.73, backsolve BO3) |
|-----------------------|------------------------------|-------------------------------------------------|
| `P(draw)` prédit      | `2 · 0.85 · 0.15 = 25.5 %`   | `2 · 0.73 · 0.27 ≈ 39.4 %`                      |
| `oddsDraw` (10 % marg.)| `1 / (0.255 · 1.10) ≈ 3.56`  | `1 / (0.394 · 1.10) ≈ 2.31`                     |
| **Edge user pariant draw** | —                      | **+55 %** (cote ×1.54 au-dessus du fair)        |

C'est un **pari systématiquement gagnant** (EV positif pour l'user) sur tous les BO2 où un favori existe. En matchup 70/30 on est déjà à +15 % d'edge utilisateur. Seul le cas 50/50 est correct par coïncidence (car `prob1 ≈ p_per_game`).

**Direction du biais** : contre-intuitive mais claire. La formule binomiale suppose que plus un joueur est "fort" (p proche de 1), plus la draw est rare. Mais la "force" mesurée par `prob1` est déjà une proba *série*, qui amplifie les écarts (un joueur 70 % per-game gagne ≈ 78 % des BO3). Quand on ré-injecte ce 78 % comme s'il s'agissait d'un 78 % per-game, on sous-estime sévèrement `P(draw)`.

**Fix proposé (P0)** :

```ts
// oddsEngine.ts autour de la ligne 371
if (boNum % 2 === 0) {
  // prob1 est une proba de SÉRIE (données : records BO3/5/7). On backsolve
  // la proba par game via la formule binomiale du format MAJORITAIRE dans
  // les données (on assume BO3 car c'est le plus fréquent pour AoE).
  // Import depuis bets.ts ou dupliquer ici.
  const pPerGame = solvePerGameProb(prob1, 'BO3');
  probDraw = calculateDrawProbability(pPerGame, boNum);
  probDraw = Math.max(0.05, Math.min(0.60, probDraw)); // + cap supérieur
  // … suite inchangée
}
```

Alternative plus propre : exposer `solvePerGameProb` dans `oddsEngine.ts` (aujourd'hui privée dans `bets.ts:93-109`) pour qu'elle soit réutilisable. Le modèle BO3 n'est qu'une approximation — à terme, passer en paramètre le format dominant des records historiques.

**Tests qui devraient exister et ne pas passer aujourd'hui** :
- `P(draw) ≥ P(2-0 underdog)` pour matchup 80/20 en BO2 — échoue (code prédit 0.30 vs 0.02, ok en fait, mais draw toujours sous-cotée vs réalité).
- Cohérence `1/oddsDraw` (main) ≈ `1/odds('1-1')` (exact, même match) à ±6 % près — **cohérent entre eux** car la distribution exact-BO2 utilise `oddsDraw` comme entrée (fix `22c84f3`). Donc si `oddsDraw` est mauvais, le score-exact hérite du même biais, mais les deux marchés restent arbitrage-free entre eux.

### FM-2 (P1) — Divergence odds broadcast (volume-adjusted) vs odds DB (model) utilisées pour le bet

**Où** : [betService.ts:99-101](backend/src/services/betService.ts#L99-L101) vs [betService.ts:160-164](backend/src/services/betService.ts#L160-L164) et [cron/jobs.ts:318-326](backend/src/cron/jobs.ts#L318-L326).

**Problème** : le broadcast socket `oddsUpdate` émet des cotes ajustées au volume (`adjustOddsAdvanced`), mais la DB reste aux model odds. Dans `placeBet`, `oddsAtBet` est lu depuis `match.odds1/odds2/oddsDraw` — **pas les odds broadcastées**.

**Scénario utilisateur** :
1. Tout le marché parie P2. Le volume-adjust pousse **odds1** affichée à **2.15** (incitation à parier P1).
2. User place bet P1 en s'attendant à ×2.15.
3. Server stocke `oddsAtBet = match.odds1 = 2.00`.
4. User reçoit **–7.5 %** d'espérance sans s'en rendre compte.

C'est du détriment user silencieux (pas de free money mais une mauvaise pratique / risque compliance). Également, le détriment peut aller dans l'autre sens selon les volumes : si l'ajustement baisse l'odds affichée à 1.85 et que l'user bet à 2.00 serveur, l'user est gagnant silencieusement → free money côté user.

**Fix proposé (P1)** — choisir UNE des trois stratégies, pas les mélanger :
- **A** : persister l'odds volume-adjusted en DB à chaque bet et lire depuis DB (cohérent, mais crée une boucle de feedback).
- **B** : ne PAS broadcaster les volume-adjusted odds, uniquement les model odds (perd le signal "market is moving").
- **C** : recomputer les volume-adjusted odds dans `placeBet` et les utiliser comme `oddsAtBet`. Plus correct — reflète ce que l'user voit. C'est la stratégie Stake-like.

---

## Bugs probabilistes

### B-1 (P1) — Les 1-1 en BO2 ne sont jamais stockés → biais data permanent

**Où** : [liquipediaLiveScorer.ts:881-892](backend/src/services/liquipediaLiveScorer.ts#L881-L892) + [matchVerifier.ts:215-237](backend/src/services/matchVerifier.ts#L215-L237).

Quand un BO2 finit 1-1, le `distributeDrawPayout` branch ne crée aucun `PlayerMatchRecord`. Conséquence : le modèle n'apprend **jamais** la fréquence empirique des draws. Couplé à FM-1, le problème s'aggrave à chaque tournoi joué en BO2.

**Fix** : dans la branche `isBO2Draw`, upsert un record avec `won: false, score: '1-1'` pour les deux joueurs. Adapter `oddsEngine.ts` pour compter différemment ces records (ni win, ni loss).

### B-2 (P1) — `logit * 0.85` H2H smoothing non calibré

**Où** : [oddsEngine.ts:209](backend/src/services/oddsEngine.ts#L209).

La valeur 0.85 est arbitraire. Sans backtest, impossible de savoir si elle sur-smoothe (modèle sous-confiant) ou sous-smoothe (sur-confiant). Besoin : script de calibration (voir livrable).

### B-3 (P1) — `TIER_WEIGHT` divergent entre docstring et code

**Où** : [oddsEngine.ts:23](backend/src/services/oddsEngine.ts#L23) dit `S: 3.0`, code ligne 34 dit `S: 4.0`. Le prompt d'audit lui-même a des valeurs encore différentes (`S:3, A:2…`). **Aucune de ces valeurs n'est justifiée par des données.**

**Fix** : soit marquer explicitement "arbitraire, à calibrer" (current = 4.0), soit lancer un backtest pour trouver les poids qui maximisent le log-likelihood sur les 500 derniers matchs complétés.

### B-4 (P2) — Cap `EXACT_SCORE_MAX_ODDS = 15` gonfle l'overround total

**Où** : [bets.ts:116, 194-197](backend/src/routes/bets.ts#L116).

Pour un match où `P(0-3) = 0.02` (prob théorique), fair odds = 50, capped à 15 → prob implicite = 6.67 % vs 2 % réel. Sur un BO5 avec plusieurs scores rares, l'overround agrégé peut dépasser 25 % — au-dessus du corridor cible (14–20 %). Non-dangereux pour la house (overround > 1 = marge plus haute), mais crée des **cotes trompeusement peu généreuses** sur les scores rares, ce qui peut faire fuir les utilisateurs informés.

**Fix** : abaisser `EXACT_SCORE_MAX_ODDS` à 10 (perd moins en cohérence) ou plafonner au niveau de la distribution pré-conversion en odds plutôt qu'après.

---

## Bugs integrity

### I-1 (P1) — Pas de `SELECT … FOR UPDATE` sur le solde user

**Où** : [betService.ts:106-144](backend/src/services/betService.ts#L106-L144) + [bets.ts:314-321](backend/src/routes/bets.ts#L314-L321).

La transaction utilise Prisma `$transaction` standard (niveau d'isolation `READ COMMITTED` par défaut sur Postgres). Le `coins: { decrement: amount }` est atomique au niveau SQL, donc PAS de risque de double-spend (Postgres serialize les updates sur la même row). **C'est safe en pratique.**

**Mais** : la *pré-check* `freshUser.coins < amount` puis `decrement` peut laisser le solde partir en négatif si deux requêtes concurrentes lisent `coins = 100` puis décrémentent chacune de `60`. Le `decrement` atomique fait passer `coins` de 100 → 40 → -20 **sans lever d'erreur**. Le re-check ne protège pas.

**Fix P1** : ajouter une contrainte DB `CHECK (coins >= 0)` ou utiliser un UPDATE conditionnel :
```sql
UPDATE "User" SET coins = coins - ? WHERE id = ? AND coins >= ?
```
et rejeter si `rowsAffected = 0`.

### I-2 (P1) — `POST /bets/exact` : `boNumber` utilisé pour encoder `loserGames`

**Où** : [bets.ts:319](backend/src/routes/bets.ts#L319).

Le schéma Prisma `Bet.boNumber` (schema.prisma:192) est documenté comme "which BO this bet targets (null for MATCH bets)" — donc le numéro de la map (1, 2, 3…). Mais la route `/exact` y stocke `loserGames` (0, 1, 2… = le nombre de games perdues par le gagnant). **Surcharge sémantique cachée.**

Le payout dans `distributePayout` ([betService.ts:228](backend/src/services/betService.ts#L228)) compare `bet.boNumber === actualLoserGames` — donc fonctionnel, mais *seulement parce que la route `/exact` a encodé `loserGames` dans ce champ*. Un futur dev qui touche au schéma de bet par map (BO individuel) cassera le score-exact sans s'en rendre compte.

**Fix** : ajouter un champ `loserGames Int?` sur `Bet` et migrer, OU renommer `boNumber` en `betMeta` avec un commentaire clair. Au minimum, commenter la surcharge dans le code.

### I-3 (P2) — Odds change pendant placement silencieuse

**Où** : [bets.ts:305-312](backend/src/routes/bets.ts#L305-L312).

Le commentaire dit "always use server-computed odds". L'UX actuelle : l'user click à ×6.88, le server écrit `oddsAtBet = 4.50` (si la cote a bougé). **Comportement non-documenté, potentiellement hostile.**

**Fix** : soit passer `expectedOdds` depuis le client et rejeter le bet si divergence > X %, soit toast UI "odds changed, accept?" (pattern Stake).

---

## A1 / A2 / A3 / A4 — résultats de cohérence interne

Vérifiés par construction du code (pas besoin de test DB, les formules sont déterministes) :

| Check | Statut | Détail |
|-------|--------|--------|
| **A1** overround main 2-way ∈ [1.06, 1.12] | ✅ | `HOUSE_MARGIN_2WAY = 0.06` → exactement 1.06. Post-arrondi peut varier de ±0.002. |
| **A1** overround main 3-way ∈ [1.06, 1.12] | ⚠️ | `HOUSE_MARGIN_3WAY = 0.10` → overround = 1.10, dans la plage ciblée pour 2-way mais largement au-dessus. *Le prompt d'audit cible 6-12 % pour 3-way aussi, ce qui est irréaliste en BO2* — un book pro prend 8-15 % pour un marché 3-way. Je recommande de laisser 10 %. |
| **A1** overround exact ∈ [1.14, 1.20] | ⚠️ | `1 / (1 - 0.15) = 1.176` sans cap. **Avec cap `MAX_ODDS = 15`, peut dépasser 1.25 sur BO5/BO7 avec scores rares.** |
| **A2** cohérence main ↔ exact BO2 | ✅ | `theoreticalDistribution` ([bets.ts:135-145](backend/src/routes/bets.ts#L135-L145)) normalise sur `1/odds1 + 1/oddsDraw + 1/odds2` → cohérent par construction. |
| **A2** cohérence main ↔ exact BO3+ | ⚠️ | Via `solvePerGameProb` + reconstruction binomiale puis blending. **Le blending historique peut casser la cohérence `1/odds1 (main) ≈ Σ 1/odds(P1 wins)` de quelques %.** À surveiller via le script d'audit. |
| **A3** score sets par format | ✅ | `theoreticalDistribution` énumère explicitement les scores par BO ([bets.ts:154-183](backend/src/routes/bets.ts#L154-L183)). |
| **A4** monotonie post-blend | ❌ | **Non garantie.** Le corridor [0.60, 1.60] × theory peut encore laisser `P(2-1) > P(2-0)` pour un favori si les données historiques de ce joueur le montrent souvent en dogfights. C'est statistiquement *possible* mais visuellement confusant. |

---

## Cache / cron

### E-1 (P2) — `blendCache` key n'inclut pas `oddsDraw`

**Où** : [exactScoreModel.ts:32-35](backend/src/services/exactScoreModel.ts#L32-L35).

**Impact réel = nul** car `exactScoreOddsBlended` route BO2 directement vers `exactScoreOdds` (bets.ts:230) sans passer par `buildBlendedDistribution`. **Pas un bug aujourd'hui**, mais une bombe à retardement si on décide un jour de blender aussi les BO2. À fixer par prudence (1 ligne).

### E-2 (P1) — Le fast recalc cron invalide-t-il le blendCache ?

**Où** : [cron/jobs.ts:296-310](backend/src/cron/jobs.ts#L296-L310).

**Non**. Le fast recalc update `match.odds1/odds2` en DB si changement > 0.005. Le `blendCache` a TTL 5 min mais sa clé inclut `odds1, odds2` (arrondis à 2 décimales) → un changement > 0.005 produit une clé différente → **pas de staleness**.

### E-3 (P2) — Push client : socket `oddsUpdate` vs polling

**Où** : [betService.ts:161-164](backend/src/services/betService.ts#L161-L164), [cron/jobs.ts:325-326](backend/src/cron/jobs.ts#L325-L326).

Broadcast OK via Socket.io sur `matchRoom:${matchId}`. Voir FM-2 pour le désaccord DB vs broadcast.

---

## Recommandations

1. **Bloquer toute modif du moteur tant qu'il n'existe pas de tests** (`vitest` ou `jest` — le stack a déjà zod, trivial à ajouter).
2. **Fix FM-1 en priorité** : remplacer `calculateDrawProbability(prob1, ...)` par un chemin qui passe par `solvePerGameProb`. Déploiement urgent si des BO2 AoE2 (Hidden Cup, King of the Desert) sont en cours.
3. **Suspendre les BO2 temporairement** si fix non-déployable rapidement. Alternative : réduire `MAX_ODDS` sur draw à 3.0 pour capper le free money à maximum ×3.
4. **Brancher un job de calibration hebdomadaire** : script qui recalcule Brier + log-loss + courbe de calibration sur les 200 derniers matches COMPLETED et log dans `ScraperLog`.
5. **Stocker les 1-1 BO2** en `PlayerMatchRecord` — nécessaire pour B-2 et pour la calibration future.
6. **Décider une politique unique** pour les volume-adjusted odds (FM-2) — pas les mélanger.
7. **Documenter explicitement** les tier weights et leur provenance (CLAUDE.md). Actuellement la valeur S=4 contredit trois sources de doc.
8. **Contrainte DB `CHECK (coins >= 0)`** pour couper à la racine le risque I-1.

---

## Tests à ajouter (dette bloquante)

Stack suggérée : `vitest` (plus rapide que jest, meilleure intégration ESM). Fichiers prioritaires, par ordre d'urgence :

- [ ] `backend/tests/oddsEngine.spec.ts`
  - [ ] `calculateDrawProbability(0.5, 2) = 0.5` (cas symétrique — sanity)
  - [ ] `calculateDrawProbability` retourne 0 pour BO impair
  - [ ] **TEST DE NON-RÉGRESSION FM-1** : pour prob1=0.85 en BO2, `probDraw ≥ 0.35` (après fix — aujourd'hui échoue à 0.255)
  - [ ] Overround exactement ≈ `HOUSE_MARGIN_2WAY` sur 100 inputs aléatoires
  - [ ] Overround 3-way ≈ `HOUSE_MARGIN_3WAY` sur 100 BO2 aléatoires
  - [ ] `prob1 + prob2 + probDraw ≈ 1` en BO2 à ±0.001
  - [ ] Cap `maxProb` respecté (84 % max en haut, 16 % min en bas)
- [ ] `backend/tests/exactScoreModel.spec.ts`
  - [ ] Blend reproduit la theoretical quand `h2h=[], p1=[], p2=[]`
  - [ ] Corridor clamp : un outlier à P=0.99 est ramené à `theory × 1.60` max
  - [ ] Cache key distincte pour odds différentes
  - [ ] Cache key distincte pour matchTier différents
  - [ ] Blend renormalise bien (Σ = 1.0 à ±1e-9 après clamp)
- [ ] `backend/tests/bets.integration.spec.ts`
  - [ ] `POST /bets` avec `odds: 9999` dans le body → odds ignoré, stocke `match.odds1`
  - [ ] `POST /bets/exact` avec `odds: 9999` → rejet zod (`.strict()`)
  - [ ] Refund CANCELLED = 100 % (check DB coins avant/après)
  - [ ] Race deposit : 2 requêtes parallèles de 60 sur solde 100 → une seule doit réussir (test I-1)
  - [ ] Bet P1 + match 1-1 BO2 → bet = LOST (pas REFUNDED)

---

## Hors scope (signalé, pas traité ici)

- Performance scaling (pas de problème observé).
- UI / animate-odds-flash côté front ([dev branch commit 2c80532](.)).
- NOWPayments / `paymentsService`.
- Enrichissement Claude Opus 4.6 (fonctionne, pas de bug rapporté).

---

## Livrable

- Script : [backend/scripts/audit-odds-coherence.ts](backend/scripts/audit-odds-coherence.ts)
- Rapport : ce document.
- Usage : `cd backend && npx tsx scripts/audit-odds-coherence.ts` — itère sur les matches UPCOMING, calcule overround main + exact + cohérence A2 + monotonie A4, log les violations.
