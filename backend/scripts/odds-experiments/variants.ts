/**
 * Variants to A/B test against the production baseline.
 *
 * Each variant is a partial override of the DEFAULT_HYPERPARAMS. Add a new
 * one here, re-run `run-all.ts`, and it shows up on the leaderboard.
 */
import type { Hyperparams } from './tunable-engine';

export interface Variant {
  id: string;
  description: string;
  overrides: Partial<Hyperparams>;
}

export const VARIANTS: Variant[] = [
  {
    id: 'baseline',
    description: 'Production V1 (V2_ENABLED=false, no Glicko) — reference.',
    overrides: {},
  },
  // ── Half-life axis ─────────────────────────────────────────────────────
  {
    id: 'half-life-90d',
    description: 'V2 default — half-life 90d (records 3mo = 0.5×). Pénalise davantage les anciens matchs.',
    overrides: { halfLifeDays: 90 },
  },
  {
    id: 'half-life-60d',
    description: 'Plus agressif — half-life 60d. Privilégie le très récent.',
    overrides: { halfLifeDays: 60 },
  },
  {
    id: 'half-life-365d',
    description: 'Plus lent — half-life 1 an. Pour joueurs avec longue carrière.',
    overrides: { halfLifeDays: 365 },
  },
  // ── Form weight axis ───────────────────────────────────────────────────
  {
    id: 'form-weight-0.20',
    description: 'Form 20% (vs 30% baseline). Less hot-streak influence.',
    overrides: { formWeight: 0.20 },
  },
  {
    id: 'form-weight-0.40',
    description: 'Form 40%. Plus de poids pour les hot-streaks récents.',
    overrides: { formWeight: 0.40 },
  },
  {
    id: 'form-weight-0',
    description: 'Form OFF. Test si la form factor fait du bruit ou du signal.',
    overrides: { formWeight: 0 },
  },
  // ── H2H weight axis ────────────────────────────────────────────────────
  {
    id: 'h2h-weight-0.50',
    description: 'H2H scale 0.50 (vs 0.30 baseline). Donne plus de poids aux matchups directs.',
    overrides: { h2hWeightScale: 0.50 },
  },
  {
    id: 'h2h-weight-0',
    description: 'H2H OFF. Test si H2H apporte du signal ou s\'il est noyé par les autres facteurs.',
    overrides: { h2hWeightScale: 0 },
  },
  // ── House margin (proba calibration) ───────────────────────────────────
  {
    id: 'no-house-margin',
    description: 'Margin 0% — vraies probas, pour mesurer Brier sans biais bookmaker.',
    overrides: { houseMargin2way: 0 },
  },
  // ── V2 features ────────────────────────────────────────────────────────
  {
    id: 'v2-flag-on',
    description: 'V2 entier (half-life 90d, wrLogitScale 1.15, momentum, rust v2, SOS).',
    overrides: {
      halfLifeDays: 90,
      wrLogitScale: 1.15,
      formEnabled: true,
      rustMode: 'v2-nonlinear',
      sosScale: 1.0,
    },
  },
  {
    id: 'v2-momentum-only',
    description: 'V2 momentum (streak detector) seul.',
    overrides: { formEnabled: true },
  },
  {
    id: 'v2-sos-only',
    description: 'V2 strength-of-schedule seul.',
    overrides: { sosScale: 1.0 },
  },
  // ── Glicko ─────────────────────────────────────────────────────────────
  {
    id: 'glicko-on',
    description: 'Glicko-2 enabled (uses ratings as wr signal). Baseline V1 elsewhere.',
    overrides: { useGlicko: true },
  },
  {
    id: 'glicko-plus-v2',
    description: 'Glicko + V2 features combinés.',
    overrides: {
      useGlicko: true,
      halfLifeDays: 90,
      wrLogitScale: 1.15,
      formEnabled: true,
      rustMode: 'v2-nonlinear',
      sosScale: 1.0,
    },
  },
  // ── Confidence clamps ──────────────────────────────────────────────────
  {
    id: 'tighter-clamps',
    description: 'Max prob plus serrée (0.85 max even at high confidence). Plus prudent.',
    overrides: {
      maxProbLowConf: 0.65,
      maxProbMedConf: 0.75,
      maxProbGoodConf: 0.82,
      maxProbExcellentConf: 0.88,
    },
  },
  {
    id: 'looser-clamps',
    description: 'Max prob plus large (jusqu\'à 0.95). Plus confiant sur les gros favoris.',
    overrides: {
      maxProbLowConf: 0.75,
      maxProbMedConf: 0.85,
      maxProbGoodConf: 0.90,
      maxProbExcellentConf: 0.95,
    },
  },
  // ── Equal-weight blend ─────────────────────────────────────────────────
  {
    id: 'equal-weights',
    description: '25/25/25/25 wr/h2h/form/tier (when available). Pour tester si l\'adaptive blend ajoute de la valeur.',
    overrides: {
      wrWeightFloor: 0.25,
      wrWeightScale: 0.50,
      h2hWeightScale: 0.50,
      formWeight: 0.25,
      tierCtxWeight: 0.25,
    },
  },
  // ── WR-heavy ───────────────────────────────────────────────────────────
  {
    id: 'wr-heavy',
    description: '60% wr, 20% form, 20% h2h. Confiance accrue dans la baseline statistique.',
    overrides: {
      wrWeightFloor: 0.60,
      wrWeightScale: 0.80,
      h2hWeightScale: 0.20,
      formWeight: 0.20,
    },
  },
  // ── Form count ─────────────────────────────────────────────────────────
  {
    id: 'form-last-6',
    description: 'Form sur les 6 derniers matchs (vs 12). Réagit plus vite aux switchs.',
    overrides: { formCount: 6 },
  },
  {
    id: 'form-last-25',
    description: 'Form sur 25 matchs. Lisse le bruit.',
    overrides: { formCount: 25 },
  },

  // ─── Session 2 (2026-05-02) ──────────────────────────────────────────────
  // 15 nouveaux variants couvrant ELO bayésien (3), time decay agressif (3),
  // streak / momentum (2), et combinaisons des top facteurs (3+ ).
  // Civ matchup et map preference non implémentés ici car ils nécessitent
  // un pipeline de données non encore en place (PMR ne stocke ni civ ni map
  // par game dans le schéma actuel) — voir audit/OVERNIGHT_REPORT_2_2026-05-02
  // pour le suivi.

  // ── Bayesian prior axis ─────────────────────────────────────────────────
  {
    id: 's2-prior-strong',
    description: 'Bayesian prior fort (15 pseudo-matchs à 50%). Tire fort vers même money quand data sparse.',
    overrides: { priorStrength: 15 },
  },
  {
    id: 's2-prior-weak',
    description: 'Bayesian prior faible (1 pseudo-match). Laisse l\'observation parler dès la 5e partie.',
    overrides: { priorStrength: 1 },
  },
  {
    id: 's2-prior-asym',
    description: 'Prior asymétrique 0.45 + strength 8. Anti-favorite — corrige le biais "tout le monde gagne plus que prévu".',
    overrides: { priorWinrate: 0.45, priorStrength: 8 },
  },
  // ── Time decay extra granular ───────────────────────────────────────────
  {
    id: 's2-half-life-7d',
    description: 'Half-life 7 jours. Très agressif — quasi seulement la dernière semaine compte.',
    overrides: { halfLifeDays: 7 },
  },
  {
    id: 's2-half-life-14d',
    description: 'Half-life 14 jours. Forme récente ultra-dominante.',
    overrides: { halfLifeDays: 14 },
  },
  {
    id: 's2-half-life-30d',
    description: 'Half-life 30 jours. Sweet spot probable entre 14d (overfit) et 90d (slow).',
    overrides: { halfLifeDays: 30 },
  },
  // ── Streak / momentum ───────────────────────────────────────────────────
  {
    id: 's2-streak-aggressive',
    description: 'Streak bonus 0.10 par win consécutive (cap 0.50). Capture les hot-streaks plus vite.',
    overrides: { formEnabled: true, formStreakBonus: 0.10, formStreakCap: 0.50 },
  },
  {
    id: 's2-streak-conservative',
    description: 'Streak bonus 0.03 (cap 0.15). Réduit le bruit des petites séries.',
    overrides: { formEnabled: true, formStreakBonus: 0.03, formStreakCap: 0.15 },
  },
  // ── Combinés top features ───────────────────────────────────────────────
  {
    id: 's2-combo-recent-form',
    description: 'Half-life 30d + form weight 0.40 + streak ON. "Le passé proche prime, et les streaks comptent."',
    overrides: {
      halfLifeDays: 30, formWeight: 0.40, formEnabled: true,
      formStreakBonus: 0.07, formStreakCap: 0.30,
    },
  },
  {
    id: 's2-combo-skill-driven',
    description: 'Glicko + half-life 60d + WR-heavy + step-up 0.35. Skill model maximisé.',
    overrides: {
      useGlicko: true, halfLifeDays: 60, wrLogitScale: 1.20,
      wrWeightFloor: 0.55, wrWeightScale: 0.70, formWeight: 0.20,
      stepUpPenaltyPerStep: 0.35,
    },
  },
  {
    id: 's2-combo-h2h-priority',
    description: 'H2H scale 0.50 + h2hConfidenceMaxAt 6 (boost rapide) + form 0.20. Pour matchups récurrents.',
    overrides: {
      h2hWeightScale: 0.50, h2hConfidenceMaxAt: 6,
      formWeight: 0.20,
    },
  },
  // ── Anti-overfit (response to MarineLord 1.58 issue) ────────────────────
  {
    id: 's2-anti-farm',
    description: 'SOS scale 1.5 + opponent strength stretch (a=0.3, b=1.4). Pénalise farm vs faibles.',
    overrides: {
      sosScale: 1.5, sosCap: 0.25,
      opponentStrengthA: 0.3, opponentStrengthB: 1.4,
    },
  },
  {
    id: 's2-no-form-no-streak',
    description: 'Form OFF + tier-context boost à 0.20. Pour tester si le facteur form ajoute du signal réel ou seulement du bruit.',
    overrides: { formWeight: 0, tierCtxWeight: 0.20 },
  },
  // ── Calibration tighter ─────────────────────────────────────────────────
  {
    id: 's2-margin-zero',
    description: 'Margin 0% + tighter clamps (0.85 max). Mesure pure de la calibration sans biais bookmaker.',
    overrides: {
      houseMargin2way: 0,
      maxProbLowConf: 0.65, maxProbMedConf: 0.75,
      maxProbGoodConf: 0.82, maxProbExcellentConf: 0.85,
    },
  },
  {
    id: 's2-platt-like',
    description: 'WR scale 0.85 (compresse vers 0.5). Approxime un Platt scaling sur le facteur skill.',
    overrides: { wrLogitScale: 0.85 },
  },

  // ─── Session 3 (2026-05-02) — v37-v46 ────────────────────────────────────
  // 10 nouvelles hypothèses post-merge du winner s2-combo-h2h-priority.
  // Cible : Brier ≤ 0.1850, Acc ≥ 73%, ECE ≤ 0.18.

  // v37 : booster massivement le poids du tier-context. Hypothèse : un
  // joueur qui a déjà performé en S-tier garde un edge en S-tier.
  {
    id: 'v37-tier-context-boost',
    description: 'tierCtxWeight 0.10 → 0.40 + step-up penalty x1.4. Tier-context devient un facteur primaire.',
    overrides: { tierCtxWeight: 0.40, stepUpPenaltyPerStep: 0.35 },
  },

  // v38 : streak detector très agressif (form ON + streak bonus 0.10).
  // Hypothèse : 3+ wins consécutifs en S/A indiquent un hot streak réel,
  // pas juste du bruit comme la form factor générique.
  {
    id: 'v38-streak-decay-aggressive',
    description: 'Streak ON + bonus 0.10 par win consécutive (cap 0.50) + streakWindow 5. Capture les hot streaks.',
    overrides: { formEnabled: true, formStreakBonus: 0.10, formStreakCap: 0.50, streakWindow: 5 },
  },

  // v39 : opponent strength stretch extrême — corrige plus fort le farm.
  // Hypothèse : 80% WR contre des sub-50% players doit valoir ~50%, pas 70%.
  {
    id: 'v39-opp-strength-extreme',
    description: 'Opp strength a=0.2 b=1.6 + SOS 1.5 cap 0.25. Pénalise très fort le farm.',
    overrides: { opponentStrengthA: 0.2, opponentStrengthB: 1.6, sosScale: 1.5, sosCap: 0.25 },
  },

  // v40 : équivalent v39 + h2h priority — combine deux signaux corrigeurs.
  {
    id: 'v40-anti-farm-h2h',
    description: 'v39 (anti-farm) + h2h priority weights from winner. Combine corrections.',
    overrides: {
      opponentStrengthA: 0.2, opponentStrengthB: 1.6, sosScale: 1.5, sosCap: 0.25,
      h2hWeightScale: 0.50, h2hConfidenceMaxAt: 6, formWeight: 0.20,
    },
  },

  // v41 : reset patch — hardcode la date du major patch AoE4 du 2026-04-01
  // (date approximative, à raffiner). Records avant = 50% du poids.
  {
    id: 'v41-patch-reset-2026-04',
    description: 'Patch reset 2026-04-01 → poids ×0.50 sur les records pré-patch. Test si la meta a tourné.',
    overrides: { patchResetDate: new Date('2026-04-01T00:00:00Z'), patchResetMultiplier: 0.50 },
  },

  // v42 : consistency shrinkage. Joueurs très consistants (variance < 0.20)
  // → on shrinke la prédiction vers 0.5 de 10% logit max. Anti-overconfidence.
  {
    id: 'v42-consistency-shrink',
    description: 'Si les 2 joueurs ont variance < 0.20 sur 20 derniers, shrink prob vers 0.5 (×0.10 logit). Anti-overconfidence.',
    overrides: { consistencyBonus: 0.10 },
  },

  // v43 : format-specific winrate boost. Records du même format que le
  // match courant (BO3 vs BO5) pèsent ×2.0.
  {
    id: 'v43-format-match-boost',
    description: 'Records du même format BO que le match courant comptent ×2.0. Test la spécialisation BO3/BO5.',
    overrides: { formatMatchBoost: 2.0 },
  },

  // v44 : combo des 3 axes les plus prometteurs identifiés à la session 2
  // (h2h priority, tier-context boost, streak detector).
  {
    id: 'v44-combo-h2h-tier-streak',
    description: 'h2h priority + tier-context 0.30 + streak ON. Combine les 3 signaux du leaderboard session 2.',
    overrides: {
      h2hWeightScale: 0.50, h2hConfidenceMaxAt: 6, formWeight: 0.20,
      tierCtxWeight: 0.30,
      formEnabled: true, formStreakBonus: 0.07, formStreakCap: 0.30,
    },
  },

  // v45 : prior bayésien faible + h2h priority. s2-prior-weak avait Acc 75.2%
  // mais Brier équivalent baseline ; combiner avec h2h-priority pourrait
  // garder l'Acc et pousser Brier en dessous.
  {
    id: 'v45-bayes-weak-h2h',
    description: 'Prior weak (1 pseudo-match) + h2h priority overrides. Test si on garde Acc 75% + Brier amélioré.',
    overrides: {
      priorStrength: 1,
      h2hWeightScale: 0.50, h2hConfidenceMaxAt: 6, formWeight: 0.20,
    },
  },

  // v46 : ensemble des 5 meilleurs variants — non implémentable comme un
  // simple Hyperparams override (besoin d'un orchestrateur). Voir
  // scripts/odds-experiments/variants/v46_ensemble.ts pour l'implémentation.
  // Placeholder ici juste pour documenter l'existence.
  {
    id: 'v46-ensemble-placeholder',
    description: 'Placeholder — voir variants/v46_ensemble.ts pour l\'orchestrateur réel.',
    overrides: {},
  },
];
