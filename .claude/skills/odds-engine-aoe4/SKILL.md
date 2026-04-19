---
name: odds-engine-aoe4
description: "Règles métier odds engine AOE4 — blending 4 facteurs (winrate 50%, form 30%, H2H 0-30% confidence-scaled, tier-context 10%), gestion BO1/BO2/BO3/BO5, opponent-strength multiplier, MIN_ODDS/MAX_ODDS clamps, bookmaker margin 7-9%, void-on-draw sur BO2, step-up penalty. Charger à chaque modif de backend/src/services/oddsEngine.ts, backend/src/services/pricing*, backend/scripts/debug-compare*, ou tout fichier touchant au pricing/odds/probabilités des matchs. Triggers: oddsEngine, calculateOddsV2, calculateDrawProbability, HOUSE_MARGIN, MIN_ODDS, MAX_ODDS, winrate, form factor, H2H, tier-context, opponent-strength, void-on-draw, step-up penalty, book margin, overround, binomial BO, Brier score, backtest, recalc-bo2-upcoming, debug-compare-two-players."
---

# Odds Engine AOE4 — Règles métier

## Architecture du modèle (état actuel)

Le moteur `calculateOddsV2(input)` dans [backend/src/services/oddsEngine.ts](../../../backend/src/services/oddsEngine.ts) blend 4 signaux pondérés dans l'espace logit, avec normalisation (pas de prior 50/50 injecté si des facteurs manquent) :

| Facteur | Poids | Source |
|---|---|---|
| Winrate global Bayesian tier-weighted | 50% (min 0.35, max wrConfidence × 0.50) | Tous `PlayerMatchRecord` du joueur |
| Form factor 12 derniers matchs | 30% | Last 12 records, décay 0.85, tier×dominance×draw-aware |
| H2H direct (scalé par confiance) | 0-30% (= confidence × 0.30) | Confrontations directes (max confidence à 12 matchs) |
| Tier-context WR | 10% (seulement si data dispo ou step-up) | WR au tier du match ou pénalité step-up |

Plus :
- **Opponent-strength multiplier** (0.4-1.6×) sur chaque record — battre un 80%-WR opponent compte 1.36×, battre un 20%-WR compte 0.64×
- **Max prob cap** adaptatif selon confidence : 0.70 / 0.80 / 0.87 / 0.92

## Constantes critiques

```ts
MIN_ODDS                   = 1.05  // floor absolu — évite les cotes grotesques < 1.02
MAX_ODDS                   = 20    // ceiling pour underdog extrême (historique = 50, actuel = 20)
HOUSE_MARGIN_2WAY          = 0.09  // 9% overround cible (BO3/5/7 + BO2 void-on-draw)
HOUSE_MARGIN_3WAY          = 0.10  // legacy, plus utilisé depuis BO2 void-on-draw
MIN_H2H_FOR_FULL_CONFIDENCE = 12   // scale linéaire sous ce seuil (confidence = min(1, h2h.length / 12))
DRAW_SHRINKAGE_EVEN_BO     = 0.70  // binomial P(draw) × 0.70 (empirique AoE/CS < binomial pur)
DRAW_PROB_CEILING          = 0.45  // cap max P(draw) pour éviter prédictions pathologiques
```

Tiers et leurs poids (dans `computeCompetitiveWinrate`) : S=4.0, A=2.0, Qualifier=1.5, B=1.0, C=0.5, Misc=0.3.

Tiers et leurs multiplicateurs form (dans `computeFormFactor`) : S=2.5×, A=1.8×, Qualifier=1.3×, B=1.0×, C=0.5×, Misc=0.3×.

## Règles INVIOLABLES

1. **Jamais descendre `MIN_ODDS` sous 1.03** sans validation explicite du user. En dessous, les affichages "1.01" paraissent frauduleux et le payout (1% de profit) est choquant.
2. **Jamais monter `HOUSE_MARGIN_2WAY` au-delà de 0.12** (12% overround). Au-delà, on entre en mode prédateur — Pinnacle 2-3%, CSGOEmpire 7-8%, DraftKings 8-12%.
3. **Jamais retirer le opponent-strength multiplier**. C'est le seul rempart contre l'inflation de WR par farm de tournois faibles (ex: joueur qui stack des C-tier contre des randoms pour gonfler son WR).
4. **BO2 = marché 2-way void-on-draw**. Un 1-1 rembourse tous les paris. Les cotes Chim 1.05 / Anh Huy 9.85 sont conditionnelles à "ne pas finir 1-1". La proba 1-1 explicite est affichée dans le marché "Score Exact" (pas dans le 1x2).
5. **BO3/BO5/BO7 = marché 2-way pur** (pas de draw). Formule binomiale first-to-N via `solvePerGameProb`.
6. **Draws 1-1 en BO2** → credit 0.5 dans le form factor (pas 0 = défaite). Le `won=false` stocké est misleading pour les draws. Fonction `isDraw(score)` dans `computeFormFactor`.
7. **Step-up penalty** : si un joueur n'a pas ≥4 records au tier du match mais l'autre oui, appliquer `+0.25 × (matchTierLevel - maxPlayedTierLevel)` logit au non-qualifié (capé à 3 steps = 0.75 logit). Exemple : JIF Music max=Qualifier (3), match=A (4) → +0.25 logit contre elle.
8. **Fallback WR overall sur tier-context → INTERDIT**. Si un joueur n'a jamais joué au tier, on NE compare PAS son overall vs le tier-WR de l'autre. Soit les deux ont data (tier-context full), soit step-up penalty, soit tier-context skipped.

## Antipatterns à REFUSER

- **Hardcoder des odds pour un match spécifique** (doit toujours passer par `calculateOddsV2`). Les joueurs, tiers et formats ne font pas de traitement spécial.
- **Supprimer la marge bookmaker "parce que c'est plus juste"**. Un book sans marge = modèle parfait requis, sinon EV négative garantie sur la house. On fonctionne sur des heuristiques, la marge est notre safety net.
- **Retirer le clamp `MIN_ODDS` / `MAX_ODDS`**. Nécessaire pour UX (personne ne parie à 1.01) et risk management (underdog 100:1 à découvert = liability énorme sur un bad call).
- **Blend basé sur un seul facteur** (H2H pur ou WR pur = modèle pauvre). Les 4 signaux se corrigent mutuellement.
- **Utiliser uniquement les matchs récents sans pondération anti-ancienneté** (= ignorer les perfs établies d'un vétéran). Half-life actuel = 180 jours dans `computeCompetitiveWinrate`.
- **Fallback au WR overall quand un joueur n'a pas de data au tier du match** (voir règle 8).

## Checklist avant tout commit sur oddsEngine.ts

```bash
# 1. Comparaison odds avant/après sur matchups de référence
cd backend && SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/debug-compare-two-players.ts
# Doit produire des outputs cohérents pour : ML/JIF, Wam01/SAS, Anh Huy/Chim

# 2. Dry-run recalc sur tous les UPCOMING
SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/recalc-bo2-upcoming.ts --all --dry
# Overround moyen doit être 107-110% (2-way + 9% margin = 1.09)
# Pas plus de 15% des matchs avec odd < 1.10

# 3. Audit cohérence
SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/audit-odds-coherence.ts
# Zéro violation P0 (arbitrage). P1/P2 acceptables si expliqués.

# 4. Test des 4 formats
# Vérifier BO1, BO2 (avec oddsDraw null et void-on-draw), BO3, BO5, BO7 produisent
# tous des odds sensées

# 5. Backtest optionnel (si changement majeur)
# Brier score sur les 100 derniers matchs COMPLETED doit être ≤ 0.25 (baseline WR=0.25)
```

## Références académiques (features futures à considérer)

- **Glicko-2** / **TrueSkill 2** : rating continu avec variance/volatilité, par joueur par jeu. Plus robuste que nos heuristiques blendées.
- **Bradley-Terry model** + Bayesian prior : estimation max-likelihood du skill. Gère naturellement les classements.
- **Bradley-Terry-Davidson** : extension BT qui modélise explicitement les draws (pour BO2).
- **Poisson regression** sur map-level scoring : prédire le score exact plutôt que juste le winner.
- **LOOCV** (Leave-One-Out Cross Validation) : pour calibrer les poids des 4 facteurs sur les données historiques.

Voir `audit/BO2_DRAWS_FOLLOWUP_2026-04-18.md` pour le dernier rapport d'audit.

## Outputs attendus quand Claude touche à oddsEngine.ts

1. **Diff précis** : pas de reformatting non-demandé, seulement le changement nécessaire.
2. **Résultats du script debug** avant/après sur au moins 3 matchs de référence :
   - MarineLorD vs JIF Music (BO5, tier A) — legend AoE4 vs mid sans S-data
   - Wam01 vs SAS (BO5, tier A) — deux joueurs avec data S/A des deux côtés
   - Anh Huy vs Chim Sẻ Đi Nắng (BO2, tier S) — cas extrême (crushing favorite, H2H 7-0-1)
3. **Confirmation que les 4 formats** (BO1/2/3/5) passent toujours un smoke test rapide.
4. **Commit message explicite** sur le changement de comportement attendu :
   - "feat(odds): ..." pour une nouvelle feature
   - "fix(odds): ..." pour un bug de calcul
   - "chore(odds): ..." pour rebalancing de constantes
   - Toujours mentionner l'impact chiffré sur les 3 matchups de ref

## Fichiers sous juridiction de ce skill

Triggers automatiques :
- `backend/src/services/oddsEngine.ts` — le moteur principal
- `backend/src/services/pricing*.ts` — si créé plus tard (split du moteur)
- `backend/src/services/exactScoreModel.ts` — modèle exact-score, interagit avec les odds
- `backend/src/cron/jobs.ts` — les crons `recalcActiveMatchOdds`, `enrichAllUpcomingMatches`
- `backend/src/scrapers/aoe4worldScraper.ts` — `enrichMatchWithH2H` qui consomme le moteur
- `backend/scripts/debug-compare*.ts`, `backend/scripts/*odds*.ts`, `backend/scripts/recalc*.ts`
- `backend/scripts/audit-odds*.ts`, `backend/scripts/backtest*.ts`
- `prisma/schema.prisma` — si changement du `PlayerMatchRecord` ou `Match.oddsDraw`

Hors juridiction :
- UI frontend qui affiche les odds (pas de règle métier, juste du rendering)
- `betService.ts` (paiements, settlement — a ses propres règles)
