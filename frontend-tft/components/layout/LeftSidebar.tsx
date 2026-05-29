'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signIn } from 'next-auth/react';
import {
  Home, Trophy, Swords, TrendingUp,
  User, Wallet, Gift,
  Settings,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Left rail nav, modelled after the AoM frontend's LeftSidebar but themed
 * for tft.money (purple accent instead of gold, no Games section because
 * tft.money doesn't ship roulette/coinflip/jackpot yet).
 *
 * Stays in the layout shell (`app/layout.tsx`) so it persists across route
 * transitions without remount flicker. Collapsible via the chevron at the
 * top — collapsed state is local, not persisted (intentional : the rail
 * is cheap enough to re-expand on each session).
 */

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
}

const AUTH_REQUIRED = new Set(['/profile', '/deposit', '/affiliate']);

export function LeftSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState(true);

  const bettingItems: NavItem[] = [
    { href: '/',            icon: Home,       label: 'Accueil' },
    { href: '/tournaments', icon: Trophy,     label: 'Tournois' },
    { href: '/matches',     icon: Swords,     label: 'Matchs' },
    { href: '/leaderboard', icon: TrendingUp, label: 'Classement' },
  ];

  const accountItems: NavItem[] = [
    { href: '/profile',   icon: User,   label: 'Profil' },
    { href: '/deposit',   icon: Wallet, label: 'Dépôt' },
    { href: '/affiliate', icon: Gift,   label: 'Affiliés' },
  ];

  const width = expanded ? 210 : 56;

  function NavLink({ href, icon: Icon, label }: NavItem) {
    const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
    const sharedClass = cn(
      'relative flex items-center gap-3 rounded-md transition-colors group select-none',
      expanded ? 'px-3 py-2' : 'w-10 h-10 justify-center mx-auto',
      isActive
        ? 'bg-tft-purple/10 text-tft-purple-bright'
        : 'text-tft-text-dim hover:text-tft-text hover:bg-tft-bg-hover',
    );
    const inner = (
      <>
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-tft-purple-bright rounded-r" />
        )}
        <Icon size={17} className="shrink-0" />
        {expanded && (
          <span className="text-[13px] font-medium truncate">{label}</span>
        )}
      </>
    );

    if (AUTH_REQUIRED.has(href) && !session) {
      return (
        <button
          onClick={() => signIn('steam', { callbackUrl: href })}
          className={cn(sharedClass, 'w-full text-left cursor-pointer')}
          title={`Connexion Steam requise pour ${label.toLowerCase()}`}
        >
          {inner}
        </button>
      );
    }

    return (
      <Link href={href} className={sharedClass}>
        {inner}
      </Link>
    );
  }

  return (
    <aside
      className="hidden md:flex flex-col border-r border-tft-border bg-tft-bg shrink-0 transition-all duration-200 overflow-hidden sticky top-14 self-start"
      style={{ width, height: 'calc(100vh - 3.5rem)' }}
    >
      {/* Collapse toggle */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center justify-center h-10 border-b border-tft-border text-tft-text-muted hover:text-tft-text hover:bg-tft-bg-hover transition-colors shrink-0 cursor-pointer"
        aria-label={expanded ? 'Réduire le menu' : 'Étendre le menu'}
      >
        {expanded ? <ChevronLeft size={15} /> : <ChevronRight size={15} />}
      </button>

      <nav className="flex flex-col flex-1 py-2 overflow-y-auto">
        <Section title="Paris" expanded={expanded}>
          {bettingItems.map((it) => <NavLink key={it.href} {...it} />)}
        </Section>

        <Divider />

        <Section title="Compte" expanded={expanded}>
          {accountItems.map((it) => <NavLink key={it.href} {...it} />)}
        </Section>

        {session?.user?.isAdmin && (
          <>
            <Divider />
            <Section title="Admin" expanded={expanded}>
              <NavLink href="/admin" icon={Settings} label="Admin panel" />
            </Section>
          </>
        )}
      </nav>
    </aside>
  );
}

function Section({
  title,
  expanded,
  children,
}: {
  title: string;
  expanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="px-2 space-y-0.5 mb-1">
      {expanded && (
        <p className="text-[9.5px] font-bold uppercase tracking-[0.18em] text-tft-text-muted px-2 py-1.5">
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

function Divider() {
  return <div className="mx-3 my-2 border-t border-tft-border" />;
}
