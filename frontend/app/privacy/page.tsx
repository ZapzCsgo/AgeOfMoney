'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { PrivacyModal } from '@/components/legal/PrivacyModal';

export default function PrivacyPage() {
  const { t } = useT();
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: '#07060f' }}>
      {/* Trigger button if modal closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="px-6 py-3 rounded-lg font-bold text-[13px] transition-all hover:opacity-90"
          style={{ background: '#ffc542', color: '#07060f' }}>
          {t('privacy_read_policy')}
        </button>
      )}

      {/* Modal */}
      {open && <PrivacyModal onClose={() => setOpen(false)} />}
    </div>
  );
}
