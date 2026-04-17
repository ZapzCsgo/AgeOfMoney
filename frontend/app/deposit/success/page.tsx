'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CheckCircle } from 'lucide-react';
import { useT } from '@/lib/i18n';

export default function DepositSuccessPage() {
  const { t } = useT();
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
      <div className="w-16 h-16 rounded-full bg-aoe-emerald/20 border border-aoe-emerald-bright flex items-center justify-center mb-6">
        <CheckCircle size={32} className="text-aoe-emerald-bright" />
      </div>
      <h1 className="font-cinzel font-black text-2xl tracking-[0.15em] text-aoe-gold uppercase mb-3">
        {t('deposit_success_title')}
      </h1>
      <p className="text-aoe-parchment-dim text-sm mb-2 font-cinzel tracking-wide">
        {t('deposit_success_desc')}
      </p>
      <p className="text-aoe-parchment-dim text-xs mb-8">
        {t('deposit_success_hint')}
      </p>
      <div className="flex gap-3">
        <Link href="/">
          <Button variant="gold" className="font-cinzel tracking-widest text-sm uppercase">
            {t('deposit_success_bet')}
          </Button>
        </Link>
        <Link href="/profile">
          <Button variant="outline" className="font-cinzel tracking-widest text-sm uppercase border-aoe-border text-aoe-parchment hover:border-aoe-gold hover:text-aoe-gold">
            {t('nav_profile')}
          </Button>
        </Link>
      </div>
    </div>
  );
}
