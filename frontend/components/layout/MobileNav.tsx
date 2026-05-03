'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { signInWithSteam } from '@/lib/authHelpers';
import {
  Home, Swords, Dices, Coins, Menu as MenuIcon, X,
  Trophy, TrendingUp, Crown, User, Wallet, Gift,
  Settings, LineChart, Radar, LogOut, LogIn,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import { useEventBadge } from '@/lib/useEventBadge';

/**
 * MobileNav — bottom navigation strip for phones (md:hidden).
 *
 * Five slots :
 *   1. Home
 *   2. Matches
 *   3. Roulette
 *   4. Coinflip
 *   5. Menu — opens a full drawer with everything else (Tournaments,
 *      Jackpot, Leaderboard, Profile, Deposit, Affiliate, Admin if admin,
 *      Finance / Events if owner, Sign in/out).
 *
 * Why a drawer rather than 6+ slot icons : the bottom strip caps at ~5
 * before icons + labels start crushing on a 360 px viewport. The drawer
 * is also where mobile users can sign in / out and see the section
 * groupings the desktop sidebar uses.
 */

interface NavItem {
  href: string;
  icon: React.ElementType;
  label: string;
  badge?: string;
}

export function MobileNav() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { t } = useT();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const eventBadge = useEventBadge();

  // Close drawer on route change so a tap on a link feels right.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!drawerOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [drawerOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  // 4 main nav items + 1 menu button (replaces what was Tournaments —
  // Tournaments is in the drawer so still reachable in 2 taps).
  const mainItems: NavItem[] = [
    { href: '/',         icon: Home,   label: t('nav_home') },
    { href: '/matches',  icon: Swords, label: t('nav_matches') },
    { href: '/roulette', icon: Dices,  label: t('nav_roulette') },
    { href: '/coinflip', icon: Coins,  label: t('nav_coinflip') },
  ];

  // Auth-required routes — clicking them while logged-out triggers Steam
  // OAuth with the destination as callbackUrl, same UX as desktop sidebar.
  const AUTH_REQUIRED = new Set(['/profile', '/deposit', '/affiliate']);

  const drawerSections: Array<{ title: string; items: NavItem[] }> = [
    {
      title: t('nav_section_nav'),
      items: [
        { href: '/',            icon: Home,       label: t('nav_home') },
        { href: '/matches',     icon: Swords,     label: t('nav_matches') },
        { href: '/tournaments', icon: Trophy,     label: t('nav_tournaments') },
        { href: '/leaderboard', icon: TrendingUp, label: t('nav_leaderboard') },
      ],
    },
    {
      title: t('nav_section_games'),
      items: [
        { href: '/roulette', icon: Dices, label: t('nav_roulette') },
        { href: '/coinflip', icon: Coins, label: t('nav_coinflip') },
        { href: '/jackpot',  icon: Crown, label: t('nav_jackpot') },
      ],
    },
    {
      title: t('nav_section_account'),
      items: [
        { href: '/profile',   icon: User,   label: t('nav_profile') },
        { href: '/deposit',   icon: Wallet, label: t('nav_deposit') },
        { href: '/affiliate', icon: Gift,   label: t('nav_affiliates') },
      ],
    },
  ];

  return (
    <>
      {/* Bottom strip */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden h-16 border-t"
        style={{ background: '#07060f', borderColor: '#1e1a30' }}>
        <div className="flex items-center justify-around h-full px-1">
          {mainItems.map(({ href, icon: Icon, label }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors relative',
                  active ? 'text-[#ffc542]' : 'text-[#4a4468]'
                )}
              >
                <Icon size={20} />
                <span className="text-[9px] font-medium uppercase tracking-wider truncate max-w-[48px]">
                  {label}
                </span>
                {active && (
                  <span className="absolute bottom-0 w-8 h-0.5 rounded-t bg-[#ffc542]" />
                )}
              </Link>
            );
          })}

          {/* Menu (5th slot) — opens the drawer */}
          <button
            onClick={() => setDrawerOpen(true)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 flex-1 py-2 transition-colors relative',
              drawerOpen ? 'text-[#ffc542]' : 'text-[#4a4468]'
            )}
            aria-label="Open menu"
          >
            <MenuIcon size={20} />
            <span className="text-[9px] font-medium uppercase tracking-wider">Menu</span>
            {/* Tiny badge if there's an unseen event suggestion (admin) */}
            {session?.user?.isOwner && eventBadge > 0 && (
              <span className="absolute top-1 right-2 w-2 h-2 rounded-full bg-red-500" />
            )}
          </button>
        </div>
      </nav>

      {/* Drawer overlay + sheet */}
      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60] md:hidden"
            style={{ background: 'rgba(7,6,15,0.7)', backdropFilter: 'blur(6px)' }}
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />

          {/* Sheet — slides up from bottom, sits above the bottom nav */}
          <div
            className="fixed left-0 right-0 bottom-16 z-[61] md:hidden flex flex-col rounded-t-2xl border-t shadow-2xl animate-slide-up"
            style={{
              background: '#0a0817',
              borderColor: '#1e1a30',
              maxHeight: 'calc(100vh - 64px - 56px)', // viewport - bottom nav - top navbar
              overflowY: 'auto',
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
          >
            {/* Drawer header */}
            <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b shrink-0"
              style={{ background: '#0a0817', borderColor: '#1e1a30' }}>
              <span className="font-cinzel text-[13px] font-bold tracking-widest text-[#ffc542] uppercase">
                Menu
              </span>
              <button
                onClick={() => setDrawerOpen(false)}
                className="text-[#6b6488] hover:text-[#e8e2f5] p-1"
                aria-label="Close menu"
              >
                <X size={18} />
              </button>
            </div>

            {/* Sections */}
            <div className="flex flex-col py-2">
              {drawerSections.map((section, idx) => (
                <div key={section.title}>
                  <p className="text-[10px] font-bold text-aoe-gold/70 uppercase tracking-widest px-4 py-2">
                    {section.title}
                  </p>
                  <div className="px-2 space-y-0.5">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                      const sharedClass = cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors w-full text-left',
                        isActive
                          ? 'bg-[#1a1630] text-[#ffc542]'
                          : 'text-[#c8c0e0] hover:bg-[#13111f]'
                      );
                      const inner = (
                        <>
                          <Icon size={18} className="shrink-0" />
                          <span className="text-[13px] font-medium truncate">{item.label}</span>
                        </>
                      );
                      // Auth-required path while logged-out → Steam OAuth instead.
                      if (AUTH_REQUIRED.has(item.href) && !session) {
                        return (
                          <button
                            key={item.href}
                            onClick={() => { setDrawerOpen(false); signInWithSteam(item.href); }}
                            className={sharedClass}
                          >
                            {inner}
                          </button>
                        );
                      }
                      return (
                        <Link key={item.href} href={item.href} className={sharedClass}>
                          {inner}
                        </Link>
                      );
                    })}
                  </div>
                  {idx < drawerSections.length - 1 && (
                    <div className="mx-4 my-2 border-t border-[#1a1730]" />
                  )}
                </div>
              ))}

              {/* Admin section — visible only for admins */}
              {session?.user?.isAdmin && (
                <>
                  <div className="mx-4 my-2 border-t border-[#1a1730]" />
                  <p className="text-[10px] font-bold text-aoe-gold/70 uppercase tracking-widest px-4 py-2">
                    Admin
                  </p>
                  <div className="px-2 space-y-0.5">
                    <Link
                      href="/admin"
                      className={cn(
                        'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                        pathname.startsWith('/admin') && !pathname.startsWith('/admin/finance') && !pathname.startsWith('/admin/events')
                          ? 'bg-[#1a1630] text-[#ffc542]'
                          : 'text-[#c8c0e0] hover:bg-[#13111f]'
                      )}
                    >
                      <Settings size={18} className="shrink-0" />
                      <span className="text-[13px] font-medium">{t('nav_admin')}</span>
                    </Link>
                    {session.user.isOwner && (
                      <>
                        <Link
                          href="/admin/finance"
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors',
                            pathname.startsWith('/admin/finance')
                              ? 'bg-[#1a1630] text-[#ffc542]'
                              : 'text-[#c8c0e0] hover:bg-[#13111f]'
                          )}
                        >
                          <LineChart size={18} className="shrink-0" />
                          <span className="text-[13px] font-medium">Finance</span>
                        </Link>
                        <Link
                          href="/admin/events"
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors relative',
                            pathname.startsWith('/admin/events')
                              ? 'bg-[#1a1630] text-[#ffc542]'
                              : 'text-[#c8c0e0] hover:bg-[#13111f]'
                          )}
                        >
                          <Radar size={18} className="shrink-0" />
                          <span className="text-[13px] font-medium">Events</span>
                          {eventBadge > 0 && (
                            <span className="ml-auto text-[10px] font-bold bg-[#ffc542] text-[#07060f] px-1.5 py-0.5 rounded-full">
                              {eventBadge}
                            </span>
                          )}
                        </Link>
                      </>
                    )}
                  </div>
                </>
              )}

              {/* Auth row — sign in or sign out */}
              <div className="mx-4 my-2 border-t border-[#1a1730]" />
              <div className="px-2 pb-3">
                {session ? (
                  <button
                    onClick={() => { setDrawerOpen(false); signOut(); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-left text-[#f87171] hover:bg-[#1a0e10] transition-colors"
                  >
                    <LogOut size={18} className="shrink-0" />
                    <span className="text-[13px] font-medium">{t('auth_signout')}</span>
                  </button>
                ) : (
                  <button
                    onClick={() => { setDrawerOpen(false); signInWithSteam(pathname); }}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg w-full text-left text-[#ffc542] bg-[#1a1630] hover:bg-[#22193a] transition-colors"
                  >
                    <LogIn size={18} className="shrink-0" />
                    <span className="text-[13px] font-medium">{t('auth_signin_steam')}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
