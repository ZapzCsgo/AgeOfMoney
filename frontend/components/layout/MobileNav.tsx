'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Swords, Dices, Trophy, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

export function MobileNav() {
  const pathname = usePathname();
  const { t } = useT();

  // 5 main nav items (exactly 5 — no more, no less — so nothing gets cut off)
  const items = [
    { href: '/',            icon: Home,     label: t('nav_home') },
    { href: '/matches',     icon: Swords,   label: t('nav_matches') },
    { href: '/roulette',    icon: Dices,    label: t('nav_roulette') },
    { href: '/tournaments', icon: Trophy,   label: t('nav_tournaments') },
    { href: '/deposit',     icon: Wallet,   label: t('nav_deposit') },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden h-16 border-t"
      style={{ background: '#07060f', borderColor: '#1e1a30' }}>
      <div className="flex items-center justify-around h-full px-1">
        {items.map(({ href, icon: Icon, label }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors',
                active ? 'text-[#d4a017]' : 'text-[#4a4468]'
              )}
            >
              <Icon size={20} />
              <span className="text-[9px] font-medium uppercase tracking-wider truncate max-w-[48px]">
                {label}
              </span>
              {active && (
                <span className="absolute bottom-0 w-8 h-0.5 rounded-t bg-[#d4a017]" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
