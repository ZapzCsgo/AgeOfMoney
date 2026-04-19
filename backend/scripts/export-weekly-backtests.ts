/**
 * Export DB OddsBacktestSnapshot rows → audit/weekly/<date>.md + .json.
 *
 * Railway filesystem is ephemeral — le cron weeklyOddsEngineBacktest
 * persiste les snapshots dans la DB. Ce script les dump sur disque pour
 * commit local dans `audit/weekly/`.
 *
 * Usage :
 *   cd backend && DATABASE_URL='...' npx tsx scripts/export-weekly-backtests.ts
 *   cd .. && git add audit/weekly && git commit -m 'docs(audit): weekly backtests'
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { formatBacktestMarkdown, type BacktestResult } from '../src/services/backtestHarness';

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<Array<{
    runat: Date; fullreport: BacktestResult;
  }>>(
    `SELECT "runAt" AS runat, "fullReport" AS fullreport FROM "OddsBacktestSnapshot" ORDER BY "runAt" ASC`
  );
  console.log(`[Export] ${rows.length} snapshots found in DB`);

  const outDir = join(process.cwd(), '..', 'audit', 'weekly');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  for (const row of rows) {
    const date = new Date(row.runat).toISOString().slice(0, 10);
    const mdPath = join(outDir, `${date}.md`);
    const jsonPath = join(outDir, `${date}.json`);
    const report = row.fullreport as BacktestResult;
    writeFileSync(mdPath, formatBacktestMarkdown(report));
    writeFileSync(jsonPath, JSON.stringify(report, null, 2));
    console.log(`  ${date} → ${mdPath}`);
  }
  console.log(`[Export] Done. Don't forget to: git add audit/weekly && git commit`);
  await prisma.$disconnect();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
