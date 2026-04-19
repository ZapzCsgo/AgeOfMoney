/**
 * Standalone runner autour de `runExactScoreBacktest`. Imprime RPS / Brier /
 * Log-loss / Top-accuracy globaux + par format, + les 10 pires erreurs.
 *
 * Usage :
 *   SKIP_SERVER=1 DATABASE_URL='...' npx tsx scripts/backtest-exact-score.ts
 *
 * Écrit aussi le markdown dans audit/BASELINE_EXACT_SCORE_<date>.md pour
 * historiser la run.
 */

import { runExactScoreBacktest, formatExactScoreMarkdown } from '../src/services/exactScoreBacktestHarness';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

async function main() {
  console.log('[ExactScoreBacktest] Running…\n');
  const result = await runExactScoreBacktest();

  console.log(`Overall  N=${result.overall.n}`);
  console.log(`  RPS               : ${result.overall.rps.toFixed(4)}`);
  console.log(`  Brier (multi)     : ${result.overall.brier.toFixed(4)}`);
  console.log(`  Log-loss          : ${result.overall.logLoss.toFixed(4)}`);
  console.log(`  Top-choice acc    : ${(result.overall.topChoiceAccuracy * 100).toFixed(1)}%`);
  console.log();
  console.log('By format:');
  for (const [fmt, m] of Object.entries(result.byFormat).sort()) {
    console.log(
      `  ${fmt.padEnd(4)}  N=${String(m.n).padStart(3)}` +
      `  RPS=${m.rps.toFixed(4)}  Brier=${m.brier.toFixed(4)}  LL=${m.logLoss.toFixed(4)}  TopAcc=${(m.topChoiceAccuracy * 100).toFixed(1)}%`
    );
  }

  if (result.skipped.missingOdds || result.skipped.formatUnknown || result.skipped.invalidScore || result.skipped.scoreNotInCatalogue) {
    console.log('\nSkipped:');
    for (const [k, v] of Object.entries(result.skipped)) if (v) console.log(`  ${k}: ${v}`);
  }

  // Worst 10 predictions (highest RPS)
  const worst = [...result.predictions].sort((a, b) => b.rps - a.rps).slice(0, 10);
  console.log('\nTop 10 worst predictions (by RPS):');
  for (const p of worst) {
    console.log(
      `  [${p.format} ${p.date}] ${p.label.padEnd(35)}` +
      `  actual=${p.actualScore}  top=${p.predictedTop}(${(p.predictedTopProb * 100).toFixed(0)}%)` +
      `  P(actual)=${(p.actualProb * 100).toFixed(0)}%  RPS=${p.rps.toFixed(3)}`
    );
  }

  // Persist markdown snapshot
  const outDir = join(process.cwd(), '..', 'audit');
  if (existsSync(outDir)) {
    const path = join(outDir, `BASELINE_EXACT_SCORE_${result.datestamp}.md`);
    const md = formatExactScoreMarkdown(result);
    const tail = [
      '',
      '## 10 pires prédictions (par RPS)',
      '',
      '| Format | Date | Matchup | Actual | Top predicted | P(top) | P(actual) | RPS |',
      '|---|---|---|---|---|---|---|---|',
      ...worst.map(p =>
        `| ${p.format} | ${p.date} | ${p.label} | ${p.actualScore} | ${p.predictedTop} | ${(p.predictedTopProb * 100).toFixed(0)}% | ${(p.actualProb * 100).toFixed(0)}% | ${p.rps.toFixed(3)} |`
      ),
    ].join('\n');
    writeFileSync(path, md + tail);
    console.log(`\nReport saved: ${path}`);
  } else {
    console.log('\n(audit/ not found — markdown not written)');
  }

  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  await prisma.$disconnect();
}

main().catch(err => {
  console.error('[ExactScoreBacktest] Fatal:', err);
  process.exit(1);
});
