/**
 * /admin/finance — owner-only finance dashboard (tft.money port).
 *
 * Server component. Auth check happens here BEFORE rendering. Non-owners
 * get a clean "Forbidden" surface (not notFound) per spec. Defense-in-
 * depth: the client FinanceDashboard component re-checks
 * session.user.isOwner in case the session drifts mid-browse. Backend
 * /api/v1/admin/finance/* is the final gate
 * (see backend/src/middleware/auth.ts#requireOwner).
 */

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { FinanceDashboard } from './_components/FinanceDashboard';

export const dynamic = 'force-dynamic';

export default async function AdminFinancePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.isOwner) {
    return (
      <div className="min-h-screen bg-tft-bg text-tft-text flex items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-3xl font-display font-bold text-tft-purple-bright tracking-wider uppercase">
            Forbidden
          </h1>
          <p className="text-[12px] tracking-widest uppercase mt-2 text-tft-text-muted">
            Cette page est reservee au proprietaire.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-tft-bg text-tft-text">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Page header */}
        <div className="mb-5">
          <h1 className="text-3xl font-display font-bold text-tft-purple-bright tracking-wider">
            FINANCE
          </h1>
          <p className="text-[11px] tracking-widest uppercase mt-1 text-tft-text-muted">
            Owner-only dashboard · signed in as {session.user.name ?? session.user.email ?? session.user.id}
          </p>
        </div>

        <FinanceDashboard />
      </div>
    </div>
  );
}
