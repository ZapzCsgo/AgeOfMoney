/**
 * /admin/events — Event Opportunities radar, owner-only.
 *
 * Server component. Same SSR-guard contract as /admin/finance : non-owners
 * get `notFound()` (Next 404, no leak about the route's existence). Backend
 * routes under /api/v1/admin/events/* are the real gate — see
 * backend/src/middleware/auth.ts#requireOwner + adminEvents.ts.
 */

import { getServerSession } from 'next-auth';
import { notFound } from 'next/navigation';
import { authOptions } from '@/lib/auth';
import { EventsDashboard } from './_components/EventsDashboard';

export const dynamic = 'force-dynamic';

export default async function AdminEventsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.isOwner) {
    notFound();
  }

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1
            className="text-3xl font-bold"
            style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}
          >
            EVENT OPPORTUNITIES
          </h1>
          <p className="text-[11px] tracking-widest uppercase mt-1" style={{ color: '#6b6488' }}>
            Radar automatique · 8 rules · scan toutes les 6 h
          </p>
        </div>

        <EventsDashboard />
      </div>
    </div>
  );
}
