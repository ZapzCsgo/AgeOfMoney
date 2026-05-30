/**
 * /admin/events — Event Opportunities radar, owner-only.
 *
 * Server component. Non-owners get `notFound()` (Next 404, no leak about
 * the route's existence). Backend routes under /api/v1/admin/events/* are
 * the real gate — see backend/src/middleware/auth.ts#requireOwner +
 * adminEvents.ts.
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
    <div className="min-h-screen bg-tft-bg text-tft-text">
      <div className="max-w-5xl mx-auto px-4 py-6">
        <div className="mb-5">
          <h1 className="font-display text-3xl font-bold text-tft-purple-bright">
            EVENT OPPORTUNITIES
          </h1>
          <p className="font-ui text-[11px] tracking-widest uppercase mt-1 text-tft-text-muted">
            Radar automatique · 8 rules · scan toutes les 6 h
          </p>
        </div>

        <EventsDashboard />
      </div>
    </div>
  );
}
