'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { signInWithSteam } from '@/lib/authHelpers';
import {
  Home, Swords, Trophy, User, Settings, Wallet, ChevronLeft, ChevronRight,
  TrendingUp, Star, Bell, Users, Dices, Gift, Coins, Crown, LineChart, Radar
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useEventBadge } from '@/lib/useEventBadge';

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: string;
}

export function LeftSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [expanded, setExpanded] = useState(true);
  const { t } = useT();
  const eventBadge = useEventBadge();

  const bettingItems: NavItem[] = [
    { href: '/',            icon: Home,       label: t('nav_home') },
    { href: '/matches',     icon: Swords,     label: t('nav_matches') },
    { href: '/tournaments', icon: Trophy,     label: t('nav_tournaments') },
    { href: '/leaderboard', icon: TrendingUp, label: t('nav_leaderboard') },
  ];

  const gamesItems: NavItem[] = [
    { href: '/roulette', icon: Dices, label: t('nav_roulette') },
    { href: '/coinflip', icon: Coins, label: t('nav_coinflip') },
    { href: '/jackpot',  icon: Crown, label: t('nav_jackpot') },
  ];

  const accountItems: NavItem[] = [
    { href: '/profile',   icon: User,   label: t('nav_profile') },
    { href: '/deposit',   icon: Wallet, label: t('nav_deposit') },
    { href: '/affiliate', icon: Gift,   label: t('nav_affiliates') },
  ];

  const width = expanded ? 220 : 60;

  /** Routes that require an authenticated user to be useful. When the user
   * isn't logged in, clicking those should trigger Steam OAuth (with the
   * destination as callbackUrl) instead of navigating to a page that just
   * shows a sign-in prompt. The sidebar is the most discoverable nav, so
   * the UX has to be sharp. */
  const AUTH_REQUIRED_PATHS = new Set(['/profile', '/deposit', '/affiliate']);

  function NavLink({ href, icon: Icon, label, badge }: NavItem) {
    const isActive = pathname === href || (href !== '/' && pathname.startsWith(href));
    const sharedClass = cn(
      'relative flex items-center gap-3 rounded-lg transition-all duration-150 group select-none',
      expanded ? 'px-3 py-2.5' : 'w-10 h-10 justify-center',
      isActive
        ? 'bg-[#1a1630] text-[#ffc542]'
        : 'text-[#6b6488] hover:text-[#c8c0e0] hover:bg-[#13111f]'
    );
    const innerContent = (
      <>
        {/* Active indicator */}
        {isActive && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-[#ffc542] rounded-r" />
        )}
        <Icon size={18} className="shrink-0" />
        {expanded && (
          <span className="text-[13px] font-medium truncate">{label}</span>
        )}
        {badge && expanded && (
          <span className="ml-auto text-[10px] font-bold bg-[#ffc542] text-[#07060f] px-1.5 py-0.5 rounded-full">
            {badge}
          </span>
        )}
      </>
    );

    // Auth-required route + user not logged in → swap the Link for a button
    // that triggers Steam OAuth, with the target route as callbackUrl so the
    // user lands on the page they actually wanted after login.
    if (AUTH_REQUIRED_PATHS.has(href) && !session) {
      return (
        <button
          onClick={() => signInWithSteam(href)}
          className={cn(sharedClass, 'w-full text-left')}
          title={`Sign in with Steam to access ${label.toLowerCase()}`}
        >
          {innerContent}
        </button>
      );
    }

    return (
      <Link href={href} className={sharedClass}>
        {innerContent}
      </Link>
    );
  }

  return (
    <aside
      className="flex flex-col border-r border-[#1e1a30] bg-[#0a0817] shrink-0 transition-all duration-200 overflow-hidden"
      style={{ width }}
    >
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-center h-11 border-b border-[#1e1a30] text-[#6b6488] hover:text-[#c8c0e0] hover:bg-[#13111f] transition-all shrink-0"
      >
        {expanded ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
      </button>

      <div className="flex flex-col flex-1 py-2 overflow-hidden">
        {/* Section: Betting */}
        <div className={cn('px-2 space-y-0.5', expanded && 'mb-1')}>
          {expanded && (
            <p className="text-[10px] font-bold text-aoe-gold/70 uppercase tracking-widest px-2 py-2">
              {t('nav_section_nav')}
            </p>
          )}
          {bettingItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>

        {/* Divider */}
        <div className="mx-3 my-2 border-t border-[#1a1730]" />

        {/* Section: Games */}
        <div className={cn('px-2 space-y-0.5', expanded && 'mb-1')}>
          {expanded && (
            <p className="text-[10px] font-bold text-aoe-gold/70 uppercase tracking-widest px-2 py-2">
              {t('nav_section_games')}
            </p>
          )}
          {gamesItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>

        {/* Divider */}
        <div className="mx-3 my-2 border-t border-[#1a1730]" />

        {/* Section: Account */}
        <div className={cn('px-2 space-y-0.5', expanded && 'mb-1')}>
          {expanded && (
            <p className="text-[10px] font-bold text-aoe-gold/70 uppercase tracking-widest px-2 py-2">
              {t('nav_section_account')}
            </p>
          )}
          {accountItems.map((item) => (
            <NavLink key={item.href} {...item} />
          ))}
        </div>

        {/* Admin */}
        {session?.user?.isAdmin && (
          <>
            <div className="mx-3 my-3 border-t border-[#1a1730]" />
            <div className="px-2">
              <NavLink href="/admin" icon={Settings} label={t('nav_admin')} />
              {/* Finance + Events — OWNER only (Zapz). Regular admins/mods
                  never see these links, and if they try /admin/finance or
                  /admin/events directly the page SSR-redirects to 404
                  (does not confirm the route exists). */}
              {session.user.isOwner && (
                <>
                  <NavLink href="/admin/finance" icon={LineChart} label="Finance" />
                  <NavLink
                    href="/admin/events"
                    icon={Radar}
                    label="Events"
                    badge={eventBadge > 0 ? String(eventBadge) : undefined}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
