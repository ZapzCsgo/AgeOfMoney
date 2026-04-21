/**
 * /admin/finance — owner-only finance dashboard.
 *
 * Server component. Auth check happens here BEFORE rendering. Non-owners
 * hit Next.js 404, same surface as any unknown route, so they cannot tell
 * this page exists. Defense-in-depth: the client FinanceDashboard
 * component re-checks session.user.isOwner (see _components/FinanceDashboard.tsx)
 * in case the session drifts mid-browse. Backend /api/v1/admin/finance/*
 * is the final gate (see backend/src/middleware/auth.ts#requireOwner).
 */

import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { FinanceDashboard } from './_components/FinanceDashboard';

export const dynamic = 'force-dynamic';

export default async function AdminFinancePage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isOwner) {
    notFound();
  }

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Page header */}
        <div className="mb-5">
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

        <FinanceDashboard />
      </div>
    </div>
  );
}
