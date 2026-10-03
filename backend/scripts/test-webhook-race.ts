// Throwaway check for the creditPaidDeposit race fix in payments.ts.
// Can't import creditPaidDeposit directly — payments.ts pulls `prisma` from
// ../index, which executes the full server bootstrap (app.listen, all
// routers) as an import side effect. Instead this replicates the exact
// atomic-claim mechanism (UPDATE ... WHERE status='pending') the fix added,
// against the demo DB, and proves only one of two concurrent callers wins.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function claim(transactionId: string) {
  const r = await prisma.transaction.updateMany({
    where: { id: transactionId, status: 'pending' },
    data: { status: 'completed' },
  });
  return r.count === 1;
}

async function main() {
  const user = await prisma.user.findFirst({ where: { username: { startsWith: 'Demo_' } } });
  if (!user) throw new Error('No Demo_ user found — run seed-demo.ts first');

  const tx = await prisma.transaction.create({
    data: { userId: user.id, type: 'deposit', amount: 500, coins: '5.00000000', status: 'pending' },
  });

  const [won1, won2] = await Promise.all([claim(tx.id), claim(tx.id)]);
  const winners = [won1, won2].filter(Boolean).length;

  console.log(`concurrent claims: [${won1}, ${won2}], winners=${winners}`);
  if (winners !== 1) throw new Error(`FAIL: expected exactly 1 winner, got ${winners}`);
  console.log('PASS: atomic UPDATE...WHERE status=pending lets exactly one of two concurrent callers claim the transaction');

  await prisma.transaction.delete({ where: { id: tx.id } });
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
