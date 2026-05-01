/**
 * Variant harness — runs every variant in `variants.ts` over the snapshot
 * and writes a leaderboard ranked by Brier score.
 *
 * Usage :
 *   1. (one-time, when DB is up) : npx tsx scripts/odds-experiments/snapshot-data.ts
 *   2. : npx tsx scripts/odds-experiments/run-all.ts [--n=200] [--filter=baseline,glicko-on]
 *
 * Output :
 *   - audit/ODDS_LEADERBOARD_<date>.md  (leaderboard)
 *   - audit/ODDS_VARIANTS_<date>.json   (full predictions per variant)
 *
 * No data leakage : for each match in the measurement window, the variant
 * sees only PMR rows whose `matchDate < match.scheduledAt`.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  calculateOddsTuned,
  DEFAULT_HYPERPARAMS,
  type Hyperparams,
  type MatchRecord,
  type H2HRecord,
  type TunedInput,
} from './tunable-engine';
import { VARIANTS } from './variants';
import {
  computeUpdatedRating, DEFAULT_RATING, DEFAULT_RD, DEFAULT_VOL, type RatingTriple,
} from '../../src/services/glicko2';

const SCALE = 173.7178;

interface PmrSnapshot {
  playerId: string;
  opponentId: string | null;
  won: boolean;
  tier: string | null;
  matchDate: string | null;
  score: string | null;
  confidence: number | null;
}

interface MatchSnapshot {
  id: string;
  scheduledAt: string;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
  player1LastMatchAt: string | null;
  player2LastMatchAt: string | null;
  winnerId: string | null;
  resultScore: string | null;
  format: string;
  tournamentTier: string | null;
}

interface Snapshot {
  snapshotAt: string;
  pmr: PmrSnapshot[];
  matches: MatchSnapshot[];
}

interface Pred { matchId: string; prob1: number; outcome: 0 | 1 | 'draw'; format: string }

interface VariantMetrics {
  id: string;
  description: string;
  brier: number;
  logLoss: number;
  ece: number;
  accuracy: number;
  nValid: number;
  nDrawsExcluded: number;
  buckets: Array<{ predMean: number; actMean: number; n: number }>;
}

function parseScore(score: string | null): { isDraw: boolean } {
  if (!score) return { isDraw: false };
  const m = score.match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!m) return { isDraw: false };
  return { isDraw: parseInt(m[1], 10) === parseInt(m[2], 10) && parseInt(m[1], 10) >= 1 };
}

function metrics(preds: Pred[], opts: { id: string; description: string }): VariantMetrics {
  const valid = preds.filter(p => p.outcome !== 'draw');
  const draws = preds.length - valid.length;
  let brierSum = 0, logLossSum = 0, hits = 0;
  const buckets: Array<{ preds: number[]; outs: number[] }> = [];
  for (let i = 0; i < 10; i++) buckets.push({ preds: [], outs: [] });
  for (const p of valid) {
    const y = p.outcome === 1 ? 1 : 0;
    brierSum += (p.prob1 - y) ** 2;
    const c = Math.max(0.001, Math.min(0.999, p.prob1));
    logLossSum += -(y * Math.log(c) + (1 - y) * Math.log(1 - c));
    if ((p.prob1 >= 0.5 ? 1 : 0) === y) hits++;
    buckets[Math.min(9, Math.floor(p.prob1 * 10))].preds.push(p.prob1);
    buckets[Math.min(9, Math.floor(p.prob1 * 10))].outs.push(y);
  }
  const bucketStats = buckets.map(b => ({
    predMean: b.preds.length ? b.preds.reduce((a, x) => a + x, 0) / b.preds.length : 0,
    actMean: b.outs.length ? b.outs.reduce((a, x) => a + x, 0) / b.outs.length : 0,
    n: b.preds.length,
  }));
  const totalN = valid.length;
  const ece = bucketStats.reduce((acc, b) => acc + (b.n / totalN) * Math.abs(b.predMean - b.actMean), 0);
  return {
    id: opts.id,
    description: opts.description,
    brier: brierSum / valid.length,
    logLoss: logLossSum / valid.length,
    ece,
    accuracy: hits / valid.length,
    nValid: valid.length,
    nDrawsExcluded: draws,
    buckets: bucketStats,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const nArg = args.find(a => a.startsWith('--n='));
  const filterArg = args.find(a => a.startsWith('--filter='));
  const n = nArg ? parseInt(nArg.split('=')[1], 10) : 200;
  const filterIds = filterArg ? new Set(filterArg.split('=')[1].split(',')) : null;

  const snapshotPath = join(__dirname, '.snapshot.json');
  if (!existsSync(snapshotPath)) {
    console.error(`[run-all] Missing snapshot at ${snapshotPath}.`);
    console.error(`[run-all] Run first :  npx tsx scripts/odds-experiments/snapshot-data.ts`);
    process.exit(2);
  }
  console.log(`[run-all] Loading snapshot from ${snapshotPath}…`);
  const snap: Snapshot = JSON.parse(readFileSync(snapshotPath, 'utf-8'));
  console.log(`[run-all] Snapshot from ${snap.snapshotAt}`);
  console.log(`[run-all] ${snap.pmr.length} PMR rows + ${snap.matches.length} completed matches`);

  // Build per-player PMR index, sorted by date
  type PmrParsed = Omit<PmrSnapshot, 'matchDate'> & { matchDate: Date | null };
  const pmrByPlayer = new Map<string, PmrParsed[]>();
  for (const r of snap.pmr) {
    const list = pmrByPlayer.get(r.playerId) ?? [];
    list.push({ ...r, matchDate: r.matchDate ? new Date(r.matchDate) : null });
    pmrByPlayer.set(r.playerId, list);
  }
  for (const list of pmrByPlayer.values()) {
    list.sort((a, b) => (a.matchDate?.getTime() ?? 0) - (b.matchDate?.getTime() ?? 0));
  }

  const recordsBefore = (playerId: string, cutoff: Date): MatchRecord[] => {
    const list = pmrByPlayer.get(playerId) ?? [];
    return list
      .filter(r => !r.matchDate || r.matchDate < cutoff)
      .map(r => ({
        won: r.won,
        tier: r.tier ?? 'B',
        matchDate: r.matchDate,
        opponentId: r.opponentId,
        score: r.score,
      }));
  };

  const h2hBefore = (p1: string, p2: string, cutoff: Date): H2HRecord[] => {
    const l = pmrByPlayer.get(p1) ?? [];
    const result: H2HRecord[] = [];
    for (const r of l) {
      if (r.opponentId !== p2) continue;
      if (r.matchDate && r.matchDate >= cutoff) continue;
      result.push({
        winner: (r.won ? 1 : 2) as 1 | 2,
        tier: r.tier ?? 'B',
        matchDate: r.matchDate,
        confidence: r.confidence ?? 0.8,
      });
    }
    return result.sort((a, b) => (b.matchDate?.getTime() ?? 0) - (a.matchDate?.getTime() ?? 0)).slice(0, 40);
  };

  // Replay events chronologically + maintain Glicko ratings
  const events = snap.matches.filter(m => m.resultScore || m.winnerId).map(m => ({
    ...m,
    scheduledAt: new Date(m.scheduledAt),
    player1LastMatchAt: m.player1LastMatchAt ? new Date(m.player1LastMatchAt) : null,
    player2LastMatchAt: m.player2LastMatchAt ? new Date(m.player2LastMatchAt) : null,
  }));

  console.log(`[run-all] ${events.length} match events with known outcome`);
  const measurementStart = Math.max(0, events.length - n);
  console.log(`[run-all] Measurement window : last ${events.length - measurementStart} matches (asked --n=${n})`);

  interface RatingState extends RatingTriple { lastMatchDate: Date | null }
  const ratings = new Map<string, RatingState>();
  const getR = (id: string): RatingState =>
    ratings.get(id) ?? { rating: DEFAULT_RATING, rd: DEFAULT_RD, vol: DEFAULT_VOL, lastMatchDate: null };
  const inflateRd = (s: RatingState, asOf: Date): RatingState => {
    if (!s.lastMatchDate) return s;
    const monthsIdle = Math.max(0, (asOf.getTime() - s.lastMatchDate.getTime()) / (30 * 24 * 60 * 60 * 1000));
    if (monthsIdle < 1) return s;
    const phi = s.rd / SCALE;
    const phiIdle = Math.sqrt(phi * phi + monthsIdle * s.vol * s.vol);
    return { ...s, rd: Math.min(DEFAULT_RD, phiIdle * SCALE) };
  };

  const variants = filterIds ? VARIANTS.filter(v => filterIds.has(v.id)) : VARIANTS;
  if (variants.length === 0) {
    console.error('[run-all] Filter matched zero variants.');
    process.exit(2);
  }
  console.log(`[run-all] Running ${variants.length} variants (filter=${filterArg ?? 'none'})`);

  const predictionsByVariant = new Map<string, Pred[]>();
  for (const v of variants) predictionsByVariant.set(v.id, []);

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const drawInfo = parseScore(ev.resultScore);
    let outcome: 0 | 1 | 'draw';
    if (drawInfo.isDraw) outcome = 'draw';
    else if (ev.winnerId === ev.player1Id) outcome = 1;
    else if (ev.winnerId === ev.player2Id) outcome = 0;
    else { continue; }

    if (i >= measurementStart) {
      const p1Recs = recordsBefore(ev.player1Id, ev.scheduledAt);
      const p2Recs = recordsBefore(ev.player2Id, ev.scheduledAt);
      if (p1Recs.length > 0 && p2Recs.length > 0) {
        const h2h = h2hBefore(ev.player1Id, ev.player2Id, ev.scheduledAt);
        const now = ev.scheduledAt.getTime();
        const days1 = ev.player1LastMatchAt ? Math.max(0, (now - ev.player1LastMatchAt.getTime()) / 86400000) : 30;
        const days2 = ev.player2LastMatchAt ? Math.max(0, (now - ev.player2LastMatchAt.getTime()) / 86400000) : 30;
        const r1 = inflateRd(getR(ev.player1Id), ev.scheduledAt);
        const r2 = inflateRd(getR(ev.player2Id), ev.scheduledAt);

        const baseInput: TunedInput = {
          p1Records: p1Recs, p2Records: p2Recs, h2h,
          daysSinceLastMatch1: days1, daysSinceLastMatch2: days2,
          matchTier: ev.tournamentTier ?? undefined,
          format: ev.format,
          glickoRating1: r1.rating, glickoRd1: r1.rd,
          glickoRating2: r2.rating, glickoRd2: r2.rd,
        };

        for (const v of variants) {
          const hp: Hyperparams = { ...DEFAULT_HYPERPARAMS, ...v.overrides };
          const out = calculateOddsTuned(baseInput, hp);
          predictionsByVariant.get(v.id)!.push({
            matchId: ev.id,
            prob1: out.prob1,
            outcome,
            format: ev.format,
          });
        }
      }
    }

    const r1Pre = inflateRd(getR(ev.player1Id), ev.scheduledAt);
    const r2Pre = inflateRd(getR(ev.player2Id), ev.scheduledAt);
    const score1: 0 | 0.5 | 1 = drawInfo.isDraw ? 0.5 : outcome === 1 ? 1 : 0;
    const score2: 0 | 0.5 | 1 = score1 === 1 ? 0 : score1 === 0 ? 1 : 0.5;
    const r1N = computeUpdatedRating(r1Pre, [{ opponentRating: r2Pre.rating, opponentRd: r2Pre.rd, score: score1 }]);
    const r2N = computeUpdatedRating(r2Pre, [{ opponentRating: r1Pre.rating, opponentRd: r1Pre.rd, score: score2 }]);
    ratings.set(ev.player1Id, { ...r1N, lastMatchDate: ev.scheduledAt });
    ratings.set(ev.player2Id, { ...r2N, lastMatchDate: ev.scheduledAt });

    if ((i + 1) % 1000 === 0) console.log(`  processed ${i + 1}/${events.length}`);
  }

  const results: VariantMetrics[] = [];
  for (const v of variants) {
    const preds = predictionsByVariant.get(v.id)!;
    if (preds.length === 0) {
      console.warn(`[run-all] Variant ${v.id} produced 0 predictions — skipping`);
      continue;
    }
    results.push(metrics(preds, { id: v.id, description: v.description }));
  }

  results.sort((a, b) => a.brier - b.brier);
  const baseline = results.find(r => r.id === 'baseline');

  // ── Write leaderboard markdown ──────────────────────────────────────
  const datestamp = new Date().toISOString().slice(0, 10);
  const auditDir = join(__dirname, '..', '..', '..', 'audit');
  if (!existsSync(auditDir)) mkdirSync(auditDir, { recursive: true });
  const lines: string[] = [];
  lines.push(`# Odds Engine — Variants Leaderboard (${datestamp})\n`);
  lines.push(`Métriques calculées sur les ${results[0]?.nValid ?? 0} derniers matchs COMPLETED non-draw, chronologique, no leak.\n`);
  lines.push(`Snapshot : ${snap.snapshotAt}\n`);
  lines.push(`\n| Rank | Variant ID | Brier ↓ | Log Loss ↓ | ECE ↓ | Accuracy ↑ | Δ Brier vs baseline | Notes |`);
  lines.push(`|------|-----------|---------|------------|-------|------------|---------------------|-------|`);
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const dBrier = baseline ? (r.brier - baseline.brier).toFixed(4) : 'n/a';
    lines.push(
      `| ${i + 1} | \`${r.id}\` | ${r.brier.toFixed(4)} | ${r.logLoss.toFixed(4)} | ${r.ece.toFixed(4)} | ${(r.accuracy * 100).toFixed(1)}% | ${dBrier} | ${r.description} |`
    );
  }
  lines.push(`\n_baseline = oddsEngine.ts actuel (V2_ENABLED=false, no Glicko)_\n`);
  lines.push(`\n## Stretch goals\n`);
  lines.push(`- Brier < 0.20`);
  lines.push(`- Log Loss < 0.55`);
  lines.push(`- ECE < 0.05`);
  lines.push(`- Accuracy > 70%`);
  lines.push(`\n## Top 3\n`);
  for (let i = 0; i < Math.min(3, results.length); i++) {
    const r = results[i];
    lines.push(`${i + 1}. **\`${r.id}\`** — Brier ${r.brier.toFixed(4)}, Acc ${(r.accuracy * 100).toFixed(1)}%, ECE ${r.ece.toFixed(4)}.  ${r.description}`);
  }
  lines.push(`\n## Méthodologie\n`);
  lines.push(`- Dataset : snapshot des matchs COMPLETED avec winnerId/resultScore non-null`);
  lines.push(`- Train/test split : chronologique, fenêtre de mesure = ${results[0]?.nValid ?? 0} derniers matchs valides`);
  lines.push(`- Aucun match du measurement window n'est utilisé pour entraîner (PMR strict avant \`match.scheduledAt\`)`);
  lines.push(`- Brier : \`(p - y)²\` moyenné sur les matchs avec outcome != draw`);
  lines.push(`- Log Loss : \`-[y log p + (1-y) log (1-p)]\` clip [0.001, 0.999]`);
  lines.push(`- ECE : Expected Calibration Error sur 10 buckets, weighted by bucket size`);
  lines.push(`- Glicko-2 ratings replayés in-memory depuis le début du dataset, RD inflé en cas d'inactivité`);

  const mdPath = join(auditDir, `ODDS_LEADERBOARD_${datestamp}.md`);
  writeFileSync(mdPath, lines.join('\n'));
  const jsonPath = join(auditDir, `ODDS_VARIANTS_${datestamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ snapshotAt: snap.snapshotAt, results, predictionsByVariant: Object.fromEntries(predictionsByVariant) }, null, 2));

  console.log(`\n[run-all] Wrote ${mdPath}`);
  console.log(`[run-all] Wrote ${jsonPath}`);

  console.log(`\n═══ Top 5 by Brier ═══\n`);
  for (let i = 0; i < Math.min(5, results.length); i++) {
    const r = results[i];
    const delta = baseline ? (r.brier - baseline.brier).toFixed(4) : 'n/a';
    console.log(`  ${(i + 1).toString().padStart(2)}. ${r.id.padEnd(24)}  Brier ${r.brier.toFixed(4)}  Log ${r.logLoss.toFixed(4)}  ECE ${r.ece.toFixed(4)}  Acc ${(r.accuracy * 100).toFixed(1)}%  Δ ${delta}`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
