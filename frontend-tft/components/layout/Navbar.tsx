'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import { ChevronDown, User, LogOut, Shield, Wallet, PlusCircle, Bell, ArrowDownToLine, Sparkles } from 'lucide-react';
import { cn, formatCoins } from '@/lib/utils';

/**
 * TftLogo — external SVG mark dropped in `public/logo.svg`. The mark
 * is sized via the wrapping <div> rather than next/image's `width`/`height`
 * props because the SVG already declares its viewBox and scales to its
 * container ; this keeps the navbar height as the single source of truth
 * for the mark's apparent size.
 */
function TftLogo({ size = 32 }: { size?: number }) {
  return (
    <span
      className="inline-block shrink-0"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Image
        src="/logo.svg"
        alt=""
        width={size}
        height={size}
        priority
        unoptimized
        className="w-full h-full object-contain"
      />
    </span>
  );
}

function SteamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0z"/>
    </svg>
  );
}

/**
 * Real session, wired to next-auth Steam OpenID + backend JWT (see
 * `lib/auth.ts`). Exposes only the bits the Navbar renders ; the
 * accessToken is mirrored into the api client by `<AuthTokenSync>` in
 * `components/Providers.tsx`, not here.
 */
function useSessionData() {
  const { data } = useSession();
  return {
    user: data?.user
      ? {
          name: data.user.name ?? 'Tactician',
          image: data.user.image ?? null,
          coins: data.user.coins ?? 0,
          isAdmin: data.user.isAdmin ?? false,
        }
      : null,
    // Notifications wiring lives on AgeOfMoney's NotificationsContext —
    // TFT doesn't ship that yet ; render a quiet bell with no badge.
    unreadCount: 0,
  };
}

const NAV_LINKS = [
  { href: '/', label: 'Accueil' },
  { href: '/tournaments', label: 'Tournois' },
  { href: '/matches', label: 'Matchs' },
];

export function Navbar() {
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [notifOpen, setNotifOpen]       = useState(false);
  const { user, unreadCount } = useSessionData();

  return (
    <nav
      className={cn(
        'fixed top-0 left-0 right-0 z-50 h-14 border-b border-tft-border',
        'bg-[#08081acc] backdrop-blur-md flex items-center',
      )}
    >
      {/* Arcane accent line at top — purple→cyan→gold sweep */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-arcane opacity-70" />

      <div className="flex items-center w-full px-3 md:px-5 gap-2 md:gap-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group shrink-0">
          <TftLogo />
          <span
            className={cn(
              'font-display font-bold text-[18px] md:text-[20px] tracking-[0.16em]',
              'text-tft-text group-hover:text-tft-purple-bright transition-colors',
            )}
          >
            tft.money
          </span>
        </Link>

        {/* Center nav links */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {NAV_LINKS.map((link) => {
            const active = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-4 py-1.5 font-ui text-[12.5px] tracking-[0.2em] uppercase transition-all rounded-sm relative',
                  active
                    ? 'text-tft-purple-bright'
                    : 'text-tft-text-dim hover:text-tft-text',
                )}
              >
                {link.label}
                {active && (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-gradient-arcane" />
                )}
              </Link>
            );
          })}
          {user && (
            <Link
              href="/deposit"
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 font-ui text-[12.5px] tracking-[0.2em] uppercase transition-all rounded-sm',
                pathname === '/deposit' || pathname === '/withdraw'
                  ? 'text-tft-rose'
                  : 'text-tft-text-dim hover:text-tft-rose-bright',
              )}
            >
              <PlusCircle size={13} />
              Dépôt
            </Link>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-1.5 md:gap-2 shrink-0 ml-auto">
          {user ? (
            <>
              {/* Notification bell */}
              <div className="relative">
                <button
                  onClick={() => setNotifOpen((o) => !o)}
                  className={cn(
                    'relative w-9 h-9 flex items-center justify-center rounded-md',
                    'border border-tft-border bg-tft-bg-card/60 hover:border-tft-purple/60',
                    'transition-colors cursor-pointer',
                  )}
                  aria-label="Notifications"
                >
                  <Bell size={14} className="text-tft-text-dim" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-tft-rose shadow-rose-md" />
                  )}
                </button>
              </div>

              {/* User dropdown — wallet pill + avatar */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className={cn(
                    'flex items-center rounded-md border border-tft-border bg-tft-bg-card/60',
                    'hover:border-tft-purple/60 transition-colors h-9 overflow-hidden cursor-pointer',
                  )}
                  aria-label="Compte utilisateur"
                >
                  <div
                    className="flex items-center gap-1.5 px-3 h-full border-r border-tft-border"
                    style={{ background: 'rgba(124,58,237,0.10)' }}
                  >
                    <Wallet size={12} className="text-tft-purple-bright shrink-0" />
                    <span className="font-ui font-semibold text-[12px] md:text-[13px] tabular-nums text-tft-purple-bright">
                      {formatCoins(user.coins)} ◈
                    </span>
                  </div>
                  <div className="flex items-center gap-2 px-2.5">
                    <div className="w-6 h-6 rounded-full bg-tft-bg-elevated border border-tft-border flex items-center justify-center text-[10px] font-bold text-tft-purple-bright">
                      {user.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span className="text-tft-text text-sm font-medium max-w-[80px] truncate hidden md:block">
                      {user.name}
                    </span>
                    <ChevronDown size={12} className="text-tft-text-dim hidden md:block" />
                  </div>
                </button>

                {dropdownOpen && (
                  <div
                    className={cn(
                      'absolute right-0 top-full mt-2 w-52 py-1.5 z-20 rounded-lg',
                      'border border-tft-border bg-tft-bg-card shadow-elevated',
                    )}
                  >
                    <div className="px-4 py-2.5 border-b border-tft-border mb-1">
                      <p className="text-xs text-tft-text-dim font-ui tracking-wide truncate">
                        {user.name}
                      </p>
                      <p className="text-xs font-ui font-bold mt-0.5 text-tft-purple-bright">
                        ◈ {formatCoins(user.coins)} coins
                      </p>
                      <p className="text-[10px] text-tft-text-muted mt-0.5">
                        ≈ ${(user.coins / 1.69).toFixed(2)}
                      </p>
                    </div>
                    {[
                      { href: '/profile',    icon: User,             label: 'Profil' },
                      { href: '/deposit',    icon: PlusCircle,       label: 'Dépôt' },
                      { href: '/withdraw',   icon: ArrowDownToLine,  label: 'Retrait' },
                    ].map((it) => (
                      <Link
                        key={it.href}
                        href={it.href}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-tft-text hover:bg-tft-bg-hover transition-colors"
                        onClick={() => setDropdownOpen(false)}
                      >
                        <it.icon size={14} className="text-tft-purple-bright" />
                        {it.label}
                      </Link>
                    ))}
                    {user.isAdmin && (
                      <Link
                        href="/admin"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-tft-text hover:bg-tft-bg-hover transition-colors"
                        onClick={() => setDropdownOpen(false)}
                      >
                        <Shield size={14} className="text-tft-rose-bright" />
                        Admin
                      </Link>
                    )}
                    <div className="border-t border-tft-border my-1" />
                    <button
                      onClick={() => { setDropdownOpen(false); signOut({ callbackUrl: '/' }); }}
                      className="flex items-center gap-2 px-4 py-2 text-sm text-tft-text-dim hover:bg-tft-bg-hover hover:text-tft-text transition-colors w-full text-left cursor-pointer"
                    >
                      <LogOut size={14} />
                      Déconnexion
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <button
              onClick={() => signIn('steam', { callbackUrl: pathname || '/' })}
              className={cn(
                'flex items-center gap-2 h-9 px-3.5 md:px-4 rounded-md cursor-pointer',
                'font-ui text-[12.5px] font-semibold tracking-wider uppercase text-white',
                'bg-[#1a1c34] border border-tft-border',
                'hover:border-tft-purple/70 hover:bg-tft-bg-hover transition-all',
                'shadow-arcane-sm hover:shadow-arcane-md',
              )}
            >
              <SteamIcon />
              <span className="hidden sm:inline">Steam</span>
              <Sparkles size={12} className="text-tft-purple-bright" />
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}
