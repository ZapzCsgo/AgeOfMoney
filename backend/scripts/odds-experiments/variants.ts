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
];
