# Prompt d'audit complet — Moteur de cotes AgeOfMoney

> À coller dans une session agent avec accès au repo complet.
> L'agent doit d'abord **lire** tout le code listé, puis **vérifier** chaque point, puis **proposer** des fixes avec tests.

---

## Contexte

AgeOfMoney est un site de betting AoE4/AoE2/AoE3/AoM avec coins virtuels (1 coin ⚜ ≈ 0,59 $ crédit, 1 $ retiré). Les cotes sont générées côté backend à partir de :
- Bayesian tier-weighted winrate par joueur (`backend/src/services/oddsEngine.ts`)
- H2H direct joueur vs joueur (Liquipedia scraped)
- AI-enrichment (Claude Opus 4.6) quand DB sparse (`aiPlayerHistoryScraper.ts`)
- Distribution score-exact (`exactScoreModel.ts` + `bets.ts::theoreticalDistribution`)

**Un bug a déjà été fixé** : en BO2, le score-exact ignorait `oddsDraw` et produisait des cotes incohérentes avec le main bet (ex: main "Không Được Khóc wins"=4.76 mais exact "0-2"=6.88). Voir commit `22c84f3`. Confirmer que ce fix est en place, puis auditer le reste.

---

## Objectif

Rendre le moteur de cotes **internally coherent**, **exempt de free money**, et **fidèle aux probabilités réelles** sur tous les formats (BO1 / BO2 / BO3 / BO5 / BO7) et sur tous les types de paris (match win / draw / exact score / éventuels futurs : handicap, O/U maps, first blood, etc.).

Pas de placebo : chaque problème identifié doit être mesurable (backtest sur X matchs passés).

---

## Fichiers à lire avant toute action

1. `backend/src/services/oddsEngine.ts` — probas match (prob1, prob2, probDraw) + cotes main bet
2. `backend/src/services/exactScoreModel.ts` — distribution score-exact blendée (theory + history)
3. `backend/src/routes/bets.ts` — endpoints `/api/v1/bets/*` + `theoreticalDistribution` + `exactScoreOddsBlended`
4. `backend/src/services/betService.ts` — payout, refund, validation
5. `backend/src/services/matchVerifier.ts` — détermination résultat final
6. `backend/src/services/liquipediaLiveScorer.ts` — scoring live
7. `backend/prisma/schema.prisma` — modèles Match, Bet, PlayerMatchRecord (champs `won`, `score`, `format`, `confidence`)
8. `CLAUDE.md` — décisions produit (pas d'ELO ranked, source tournoi uniquement, etc.)

---

## Audit — checklist

### A. Cohérence internal (PRIORITÉ 1 — free money risk)

Pour chaque match UPCOMING en DB, après le fix BO2, vérifier par calcul que :

**A1. No-arbitrage inter-marché**
- Main bet : somme des probas implicites `1/odds1 + 1/odds2 [+ 1/oddsDraw]` ∈ [1.06, 1.12] (overround 6–12 %)
- Score exact : somme des probas implicites `Σ 1/odds_score` ∈ [1.14, 1.20] (overround 14–20 %)
- **Interdit** : overround < 1.00 sur un marché (= arbitrage garanti pour le user)

**A2. Cohérence main-bet ↔ exact-score**
- BO2 : `1/oddsDraw` (main) ≈ `1/odds('1-1')` (exact) à ± 6 % près (delta = diff de margin)
- BO3+ : `1/odds1` (main) ≈ `Σ 1/odds(score)` for all scores où P1 wins
- Pareil pour P2

**A3. Probabilités cohérentes avec le BO**
- BO2 : score set = `{2-0, 1-1, 0-2}` exact, pas de `2-1`
- BO3 : score set = `{2-0, 2-1, 1-2, 0-2}` — pas de draw
- Pareil BO5 `{3-0, 3-1, 3-2, 2-3, 1-3, 0-3}`, BO7

**A4. Monotonie**
- Dans une colonne (ex: P1 wins) en BO3+, le score le plus serré (2-1) doit avoir une cote ≥ score le plus net (2-0) du même joueur **si** le joueur est favori (2-0 plus probable = cote plus basse). À vérifier : est-ce que cette monotonie est préservée par le blending avec les données historiques ?

**Livrable** : script `scripts/audit-odds-coherence.ts` qui lit tous les matchs UPCOMING et log les violations A1–A4 sur stdout + rapport markdown.

### B. Probabilités réalistes (PRIORITÉ 2 — fidélité modèle)

**B1. Bug potentiel : `calculateDrawProbability(prob1, boNum)` dans `oddsEngine.ts` ligne 115**
Le commentaire dit `p = prob of winning a single game` mais la fonction est appelée avec `prob1` qui est la probabilité de **gagner le match**. Vérifier ce que `prob1` représente vraiment dans les données d'entraînement :
- Si `PlayerMatchRecord.won=true` inclut uniquement les wins nets (2-0 pour BO2) → `prob1` = P(win 2-0) = p². Il faut alors faire `p = √prob1` avant de calculer P(draw).
- Si `won=true` inclut aussi les "1-1 counted as not-lost" → `prob1` est ambigu et il faut nettoyer les data.
- Chercher dans `parseScore` et le scraper Liquipedia comment sont loggés les draws.

**B2. Validation statistique**
Sur les 200 derniers matchs COMPLETED :
- Comparer P(winner) prédit par le modèle avec le winrate empirique (Brier score, log-loss)
- Tracer la courbe de calibration : bucketize les matchs par proba prédite (0–10 %, 10–20 %, …, 90–100 %) et voir si la fréquence observée matche la prédiction
- Idem pour les scores exacts : pour chaque score prédit à X %, combien de fois ce score est-il sorti ?

Un modèle bien calibré doit être ≈ sur la diagonale. Si surface supérieure (sur-confiant) ou inférieure (sous-confiant) → ajuster le smoothing (`logit * 0.85` ligne 209).

**B3. Données sparse**
- `MIN_EFFECTIVE_SAMPLE = 6` dans `exactScoreModel.ts` : quelle fraction des matchs UPCOMING tombe sous ce seuil ?
- Pour ceux-là, le blend = theoretical pur. Le théorique est-il assez bon ? (cf. B2)
- Plan AI-enrichment : quand lance-t-on le seeding avant le match ? Latence observée ?

**B4. Tier weights `{S:3, A:2, B:1, C:0.5, Qualifier:1.5, Misc:0.3}`**
Justifier chaque coefficient avec des données ou marquer "arbitraire, à calibrer". Si S-tier = 3×, confirmer que la variance des performances top-tier est réellement 3× plus prédictive que B-tier.

### C. Intégrité des paris (PRIORITÉ 1 — fraud prevention)

**C1. Odds server-side uniquement**
- Vérifier que `POST /api/v1/bets` NE prend PAS `odds` du client
- `POST /api/v1/bets/exact` : idem, `oddsAtBet` doit toujours être recomputé server-side
- Test : essayer de forger un body `{ odds: 9999 }` et confirmer que la cote sauvegardée est celle recomputée

**C2. Race condition déposits**
- Entre le moment où on lit `user.coins` et où on decrémente, un autre bet peut consommer les coins. Vérifier que la transaction Prisma gère ça (`$transaction` + `SELECT … FOR UPDATE` ou optimistic locking).

**C3. Odds change pendant placement**
- Entre `GET /exact-scores` (user voit ×6.88) et `POST /exact` (serveur recompute), les cotes peuvent avoir bougé. Le code actuel utilise systématiquement la fresh cote → user peut miser 10 coins à ×6.88 et recevoir payout à ×4.50. **Comportement attendu** ? Stake-like montre un toast "odds changed, accept new?" (marché dynamique) ; certains books refusent le bet.

### D. Payouts (PRIORITÉ 1)

**D1. Calcul payout main bet**
`payout = Math.floor(amount * oddsAtBet)` — vérifier que le floor ne crée pas d'incentive perverse (miser 11 coins à ×2.05 → floor(22.55) = 22, perd 0.05 d'espérance gratos).

**D2. Refund sur match CANCELLED**
- Si `status = CANCELLED` après 8h/24h : tous les bets sont refundés à 100 % ? Confirmer dans `betService`.
- Si le match est joué mais cancelled après coup (tournament disqualification) : politique ?

**D3. Score exact payout**
- `POST /exact` stocke-t-il `loserGames` et `score` correctement ?
- `matchVerifier` compare-t-il bien `actualScore === bet.score` avec le bon format (P1-P2 ou P2-P1) ?

**D4. Draw payout en BO2**
- Si bet P1 + match finit 1-1 : refund ou lose ? Sportsbook standard = lose (draw = outcome distinct). Vérifier.

### E. Cron et caches (PRIORITÉ 2)

**E1. Invalidation cache odds**
- `blendCache` dans `exactScoreModel.ts` a TTL 5 min + inclut odds1/odds2 dans la clé. Mais si `oddsDraw` change sans que odds1/odds2 bougent → cache stale. Ajouter `oddsDraw` à la clé (après le fix BO2).
- Cron 10 min recalcule les cotes DB-only (pas API) : est-ce que le blend cache est invalidé ?

**E2. Delta-push cotes au client**
- Aujourd'hui : polling ? Socket.io room match ? Vérifier que le client reçoit les nouvelles cotes en temps réel (sinon animate-odds-flash-up/down ne déclenche jamais).

### F. Tests qui devraient exister

- `test/oddsEngine.spec.ts` :
  - [ ] BO2 probas : somme = 1, cohérence avec BO1
  - [ ] `calculateDrawProbability` avec cases (équilibré, déséquilibré, extrême)
  - [ ] Margin ∈ [target-1%, target+1%] sur 100 matchs simulés
- `test/exactScoreModel.spec.ts` :
  - [ ] Blend reproduit theoretical quand sample=0
  - [ ] Corridor clamp fonctionne (sample outlier ne produit pas cote < theory × 0.6)
  - [ ] Cache key inclut tous les inputs pertinents
- `test/bets.integration.spec.ts` :
  - [ ] Impossible de forger odds côté client
  - [ ] Race condition deposit protection
  - [ ] Refund CANCELLED = 100%

Si aucun test n'existe, le faire remonter comme dette technique bloquante pour toute modif du moteur.

---

## Format du rapport attendu de l'agent

```markdown
# Audit Odds Engine — 2026-04-XX

## Résumé exécutif
- Status coherence : ✅ / ⚠️  / ❌
- Status calibration : ✅ / ⚠️  / ❌
- Bugs critiques trouvés : N

## Free money risks
1. [description] — fix proposé : [code] — prio : P0/P1/P2

## Bugs probabilistes
…

## Bugs integrity
…

## Recommandations
…

## Tests à ajouter
…
```

---

## Ce qui est HORS scope de cet audit

- Performance / scaling (pas de problème connu)
- UI / design (mission séparée, cf. branche `dev` après commit `2c80532`)
- Payments crypto (NOWPayments, géré dans `paymentsService`)

---

## Contexte humain

L'équipe est petite (1 dev). Le produit est en alpha. Les volumes sont faibles mais réels (argent crypto). Erreur prix plus coûteuse qu'erreur UX. **Mieux vaut une cote légèrement trop conservative (margin plus haut) qu'une cote qui laisse du free money sur la table.**
