# Phase 4 — Glicko-2 tier-weighted

**Date** : 2026-04-18
**Statut** : code + tests mergés, flag `ODDS_ENGINE_V2_ENABLED` toujours **OFF**.
**Prérequis empirique** : rebuild + backtest à re-run avec pooler URL (voir section *Validation empirique*).

---

## 1. Rappel du diagnostic Phase 3

Le rapport [PHASE3_DIAGNOSTIC_2026-04-19.md](PHASE3_DIAGNOSTIC_2026-04-19.md)
a classifié les 10 pires erreurs V2 sur backtest : **100 %** étaient "rating
faux" (RD > 150 après replay chronologique). Root-cause identifiée :

> Glicko-2 vanilla pondère toutes les wins pareil, donc un joueur qui farm
> des petits tournois hebdos et un autre qui gagne le World Championship S-tier
> progressent pareil. Résultat → ratings pollués pour les joueurs qui
> alternent gros et petits tournois (Marine, Beasty…).

La Phase 4 attaque cette cause : on garde Glicko-2 (preuve de base solide :
canonical test PASS, top 25 sensé) et on ajoute une pondération `w` par match.

---

## 2. Extension math Glicko-2 tier-weighted

Glicko standard :

```
v = 1 / Σⱼ g(φⱼ)² · E · (1−E)
Δ = v · Σⱼ g(φⱼ) · (sⱼ − E)
```

Extension (weight `wⱼ` par match, default 1.0) :

```
v = 1 / Σⱼ wⱼ · g(φⱼ)² · E · (1−E)
Δ = v · Σⱼ wⱼ · g(φⱼ) · (sⱼ − E)
```

**Identité** : avec tous les `wⱼ = 1`, on récupère Glicko-2 vanilla
**exactement** (vérifié par test de non-régression sur le canonical
example de Glickman 2013 → rating 1464.0506, RD 151.5165, vol 0.05999).

### 2.1 Table de weights

```ts
TIER_WEIGHTS = {
  S:         4.0,   // World Champ, majeurs Red Bull
  Qualifier: 2.5,   // qualifs d'un S-tier (signal aussi fort)
  A:         2.0,   // Golden League, Nili Cup
  B:         1.0,   // weekly cup "premium" (baseline)
  C:         0.4,   // weekly cup standard
  Showmatch: 0.3,   // exhibition
  Misc:      0.3,   // fallback
}
```

**Justification des valeurs** :
- Ratio S/C = 10× : un joueur qui bat le #1 mondial en finale S-tier
  doit peser autant que 10 wins en C-tier contre des randoms.
- A > Qualifier > B : une qualif S-tier vaut plus qu'une A-tier pure
  (l'enjeu rating sur la qualif est élevé — perdre = éjecté du majeur).
- Showmatch/Misc < C : exhibitions souvent scriptées, skip moral
  weight limité.
- Unknown tier → fallback 1.0 (traite comme B-tier standard).

Ces valeurs sont **ajustables** — elles vivent dans
[backend/src/services/glicko2.ts:50](../backend/src/services/glicko2.ts#L50).

### 2.2 Rating period

Inchangé par rapport à Phase 2 : 1 période = 1 match batch. La RD inflation
pour inactivité ([rebuild-ratings.ts:61](../backend/scripts/rebuild-ratings.ts#L61))
reste à 1 période = 1 mois (fix Bug #2 Phase 3).

---

## 3. Implémentation

### 3.1 Fichiers modifiés

| Fichier | Changement |
|---|---|
| [backend/src/services/glicko2.ts](../backend/src/services/glicko2.ts) | Ajout `MatchResult.weight?: number`, `TIER_WEIGHTS`, `tierWeight()`. Math étendue sur `v`, `Δ`, `sumGE`. |
| [backend/src/services/ratingEngine.ts](../backend/src/services/ratingEngine.ts) | `updateBothPlayersForMatch` accepte `tier?: string \| null` optionnel et dérive `weight` via `tierWeight()`. |
| [backend/src/services/liquipediaLiveScorer.ts](../backend/src/services/liquipediaLiveScorer.ts) | 2 call-sites (draw branch + normal branch) passent `match.tournament?.tier`. `tier: true` ajouté au `select` tournament. |
| [backend/scripts/rebuild-ratings.ts](../backend/scripts/rebuild-ratings.ts) | `MatchEvent.tier` ajouté, lecture depuis `Match.tournament.tier` (source 1) et `PlayerMatchRecord.tier` (source 2). Passe `weight` à chaque `computeUpdatedRating`. |

### 3.2 Nouveau test

[backend/scripts/test-glicko2-weighted.ts](../backend/scripts/test-glicko2-weighted.ts)

Couvre :
1. **Non-régression** : `weight=1` ≡ Glicko vanilla (rating identical, RD identical, tolérance 1e-4). ✅
2. **Signal amplifier** : S-tier loss (w=4) fait chuter le rating bien plus qu'une B-tier loss (w=1).
   → Standard loss : 1500 → 1387.3 · S-tier loss : 1500 → **1234.5**. ✅
3. **Batch mixte weighted** : W en S-tier + L en B-tier + L en C-tier → rating final plus haut
   que sans pondération (car la S-tier W domine). ✅
4. **Constants sanity check** : `tierWeight('S')=4`, `tierWeight(null)=1.0`, `tierWeight('unknown')=1.0`. ✅

Résultat : **✅ TESTS PASS**.

### 3.3 Compile + non-régression ratingEngine existant

- `npx tsc --noEmit` : clean (0 erreurs).
- Canonical Glickman test (Phase 2 original) : inchangé — passe toujours.
- Les call-sites non-Phase4 qui n'appellent pas `updateBothPlayersForMatch`
  avec un `tier` → la weight tombe sur 1.0 (fallback), comportement identique
  à Phase 2.

---

## 4. Validation empirique — *à exécuter avec accès DB*

⚠️ **Blocker local** : le `.env` pointe vers le direct Supabase
(`db.xhusoizxbjkybcafvuss.supabase.co:5432`), non joignable depuis la
connexion résidentielle (IPv6 block). Le rebuild et le backtest doivent tourner
avec le **pooler URL**, format :

```
DATABASE_URL="postgresql://postgres.xhusoizxbjkybcafvuss:PASSWORD@aws-0-<region>.pooler.supabase.com:6543/postgres?pgbouncer=true"
```

### 4.1 Étapes à lancer

```bash
# 1. Rebuild chronologique tier-weighted
cd backend
DATABASE_URL="<pooler-url>" npx tsx scripts/rebuild-ratings.ts --dry 2>&1 | tee ../audit/PHASE4_REBUILD_TOP25.log

# Sanity-check attendu sur le top 25 :
#  - Beastyqt, Liereyy, MarineLorD, Hera, JiNoo en tête (attendu)
#  - Top 25 ne doit PAS avoir des farmers hebdos (si oui → TIER_WEIGHTS trop extrêmes, à recalibrer)

# 2. Si le top 25 est OK, rebuild LIVE (écrit PlayerRating)
DATABASE_URL="<pooler-url>" npx tsx scripts/rebuild-ratings.ts

# 3. Backtest V2 tier-weighted vs V1
DATABASE_URL="<pooler-url>" npx tsx scripts/backtest-phase3-diagnostic.ts --n=50 2>&1 | tee ../audit/PHASE4_BACKTEST.json

# Lecture attendue :
#  - V1 baseline : Brier 0.2147, Accuracy 73.3%  (cf. BASELINE_ODDS_ENGINE)
#  - Phase 2 V2 : Brier 0.2543, Accuracy 66%     (worse, cf. PHASE2_BACKTEST)
#  - Phase 4 V2 : Brier ≤ 0.2147, Accuracy ≥ 73% → activer flag
#  - Phase 4 V2 : Brier entre 0.2147 et 0.2543   → borderline, flag reste OFF, recalibrer TIER_WEIGHTS
#  - Phase 4 V2 : Brier > 0.2543                 → reset TIER_WEIGHTS, back to drawing board
```

### 4.2 Critère de go-live

Même barre que Phases 1/2/3 :

> **V2 tier-weighted active le flag `ODDS_ENGINE_V2_ENABLED=true` UNIQUEMENT si** :
> - Brier V2 ≤ Brier V1 − 0.02, ET
> - Accuracy V2 ≥ Accuracy V1, ET
> - Top 25 manuel review OK (pas de farmer hebdo, pros connus en tête).

Sinon → flag reste OFF, V1 continue à servir la prod.

### 4.3 Garde-fou — safety check top 25

Si le rebuild tier-weighted donne un top 25 *n'ayant pas de sens* (ex :
Beastyqt en position 50, un inconnu en #1, un joueur avec 5 games en top 10) :
→ **STOP**, TIER_WEIGHTS trop extrêmes, recalibrer (baisser S à 3.0, monter C à 0.6, etc.).

Un top 25 "qui a du sens" ressemble à : Beastyqt / MarineLorD / Hera / Liereyy /
JiNoo / TheViper / Lyx / Yo / 1puppypaw dans les 15 premiers, tous avec
20+ games et RD < 100.

---

## 5. Décision actuelle

- Code + math : **mergés** sur master. Tests math verts.
- Flag V2 : **OFF** (inchangé depuis Phase 1). Zéro impact prod.
- Rebuild + backtest empirique : **à lancer** quand accès pooler DB dispo.

Si le rebuild donne un mauvais top 25, rien à rollback (rien n'est en prod).
Si V2 tier-weighted perd encore contre V1 → on met Phase 4 en pause et on
documente dans [ODDS_ENGINE_UPGRADE_PLAN.md](ODDS_ENGINE_UPGRADE_PLAN.md)
que Glicko seul ne bat pas les heuristiques V1 sur notre dataset AoE4 —
possible next step : ELO tournament-only + H2H booster (approche Betway/Pinnacle
simplifiée), pas Glicko.

---

## 6. Références

- [PHASE3_DIAGNOSTIC_2026-04-19.md](PHASE3_DIAGNOSTIC_2026-04-19.md) — diagnostic qui a motivé Phase 4
- [PHASE2_GLICKO2_VALIDATION_2026-04-19.md](PHASE2_GLICKO2_VALIDATION_2026-04-19.md) — Glicko baseline V2
- [BASELINE_ODDS_ENGINE_2026-04-19.md](BASELINE_ODDS_ENGINE_2026-04-19.md) — V1 production baseline
- [ODDS_ENGINE_UPGRADE_PLAN.md](ODDS_ENGINE_UPGRADE_PLAN.md) — roadmap Phase 1 → 4
- Glickman 2013 — *Example of the Glicko-2 system* (http://www.glicko.net/glicko/glicko2.pdf)
- Chess.com weighted rating for rapid/bullet distinction (reference conceptuel)
