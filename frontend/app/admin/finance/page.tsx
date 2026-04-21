/**
 * /admin/finance — owner-only finance dashboard.
 *
 * Server component. We check the session on the server BEFORE rendering:
 *   - unauthenticated  → notFound()
 *   - logged-in non-owner → notFound()
 *   - owner → render dashboard (placeholder until step 3)
 *
 * notFound() → Next.js 404 (same page as any unknown route). Non-owners
 * cannot tell this page exists at all. Backend routes under
 * /api/v1/admin/finance/* return 403 with the access attempt logged
 * at warn level — see backend/src/middleware/auth.ts#requireOwner.
 */

import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AdminFinancePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isOwner) {
    notFound();
  }

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}
          >
            FINANCE
          </h1>
          <p className="text-[11px] tracking-widest uppercase mt-1" style={{ color: '#6b6488' }}>
            Owner-only dashboard · signed in as {session.user.name ?? session.user.email ?? session.user.id}
          </p>
        </div>

        <div
          className="rounded-2xl p-8 text-center"
          style={{
            background: 'linear-gradient(135deg, #0d0b1a 0%, #110e24 100%)',
            border: '1px solid rgba(255,197,66,0.25)',
          }}
        >
          <p className="text-sm" style={{ color: '#9b94b8' }}>
            Step 1 — authentication gate is live. Owner access confirmed.
          </p>
          <p className="mt-2 text-[12px]" style={{ color: '#6b6488' }}>
            KPI cards, product breakdown, affiliates, users, cashflow and anomalies
            arrive in subsequent commits.
          </p>
        </div>
      </div>
    </div>
  );
}
