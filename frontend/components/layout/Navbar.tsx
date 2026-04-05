'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useSession, signOut } from 'next-auth/react';
import { ChevronDown, User, LogOut, Shield, Wallet, PlusCircle, Crown, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { WalletModal } from '@/components/wallet/WalletModal';
import { useT } from '@/lib/i18n';
import { useNotifications } from '@/contexts/NotificationsContext';
import { getSocket } from '@/lib/socket';

async function handleSteamLogin() {
  try {
    // Fetch CSRF token then POST — same as signIn() but more reliable in App Router
    const csrfRes = await fetch('/api/auth/csrf');
    const { csrfToken } = await csrfRes.json() as { csrfToken: string };
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/api/auth/signin/steam';
    const csrf = document.createElement('input');
    csrf.type = 'hidden'; csrf.name = 'csrfToken'; csrf.value = csrfToken;
    const callback = document.createElement('input');
    callback.type = 'hidden'; callback.name = 'callbackUrl'; callback.value = window.location.origin;
    form.appendChild(csrf);
    form.appendChild(callback);
    document.body.appendChild(form);
    form.submit();
  } catch {
    window.location.href = '/api/auth/signin/steam';
  }
}

function SteamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
    </svg>
  );
}

export function Navbar() {
  const { data: session, update } = useSession();
  const pathname = usePathname();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [walletOpen, setWalletOpen]     = useState(false);
  const [notifOpen, setNotifOpen]       = useState(false);
  const [localCoins, setLocalCoins]     = useState<number | null>(null);
  const [coinFlash, setCoinFlash]       = useState<'up' | 'down' | null>(null);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { t } = useT();
  const { notifications, unreadCount, markAllRead } = useNotifications();

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    const s = getSocket(session.user.accessToken);
    const handler = ({ coins, direction }: { coins: number; direction?: 'up' | 'down' }) => {
      setLocalCoins(coins);
      setCoinFlash(direction ?? 'up');
      if (flashTimeout.current) clearTimeout(flashTimeout.current);
      flashTimeout.current = setTimeout(() => setCoinFlash(null), 1200);
      update();
    };
    s.on('coinsUpdate', handler);
    return () => { s.off('coinsUpdate', handler); };
  }, [session?.user?.accessToken, update]);

  const displayCoins = localCoins ?? session?.user?.coins ?? 0;

  const navLinks = [
    { href: '/', label: t('nav_home') },
    { href: '/matches', label: t('nav_matches') },
    { href: '/tournaments', label: t('nav_tournaments') },
  ];

  return (
    <>
    {walletOpen && <WalletModal onClose={() => setWalletOpen(false)} />}
    <nav className="fixed top-0 left-0 right-0 z-50 h-14 border-b border-aoe-border bg-[#0a0804]/95 backdrop-blur-sm flex items-center">
      {/* Gold accent line at top */}
      <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-aoe-gold to-transparent opacity-60" />

      <div className="flex items-center w-full px-4 gap-6">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2 group shrink-0">
          <Crown size={24} className="text-aoe-gold group-hover:drop-shadow-[0_0_8px_rgba(201,162,39,0.8)] transition-all" />
          <span className="font-cinzel font-bold text-lg tracking-[0.2em] text-aoe-gold group-hover:text-aoe-gold-bright transition-colors uppercase">
            AgeOfMoney
          </span>
        </Link>

        {/* Center nav links — hidden on mobile (use bottom nav instead) */}
        <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={cn(
                'px-4 py-1.5 font-cinzel text-sm tracking-widest uppercase transition-all rounded-sm relative',
                pathname === link.href
                  ? 'text-aoe-gold'
                  : 'text-aoe-parchment-dim hover:text-aoe-parchment'
              )}
            >
              {link.label}
              {pathname === link.href && (
                <span className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-px bg-aoe-gold" />
              )}
            </Link>
          ))}
          {session && (
            <Link
              href="/deposit"
              className={cn(
                'flex items-center gap-1.5 px-4 py-1.5 font-cinzel text-sm tracking-widest uppercase transition-all rounded-sm',
                pathname === '/deposit' || pathname === '/withdraw'
                  ? 'text-aoe-gold'
                  : 'text-aoe-parchment-dim hover:text-aoe-gold'
              )}
            >
              <PlusCircle size={13} />
              {t('nav_deposit')}
            </Link>
          )}
        </div>

        {/* Right side */}
        <div className="flex items-center gap-2 shrink-0">
          {session ? (
            <>
              {/* Notification bell */}
              <div className="relative">
                <button
                  onClick={() => { setNotifOpen(o => !o); if (!notifOpen) markAllRead(); }}
                  className="relative w-9 h-9 flex items-center justify-center rounded border border-aoe-border bg-aoe-stone/30 hover:border-aoe-border-gold transition-colors"
                  title="Notifications"
                >
                  <Bell size={15} className="text-aoe-parchment-dim" />
                  {unreadCount > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-red-500" />
                  )}
                </button>

                {notifOpen && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
                    <div
                      className="absolute right-0 top-full mt-2 w-80 rounded-xl overflow-hidden shadow-2xl z-20"
                      style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
                    >
                      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e1a30]">
                        <span className="font-cinzel text-[13px] text-[#d4a017] font-bold">Notifications</span>
                        {notifications.length > 0 && (
                          <span className="text-[11px] text-[#6b6488]">{notifications.length} au total</span>
                        )}
                      </div>

                      {notifications.length === 0 ? (
                        <div className="py-8 text-center text-[13px] text-[#6b6488]">
                          Aucune notification
                        </div>
                      ) : (
                        <div className="max-h-[360px] overflow-y-auto divide-y divide-[#1a1830]">
                          {notifications.map(n => {
                            if (n.notifType === 'betResult') {
                              return (
                                <div key={n.id} className={`px-4 py-3 flex items-start gap-3 ${n.read ? 'opacity-60' : ''}`}>
                                  <span className="text-lg mt-0.5 shrink-0">{n.won ? '🏆' : '💀'}</span>
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-[13px] font-semibold ${n.won ? 'text-[#4ade80]' : 'text-[#f87171]'}`}>
                                      {n.won ? 'Pari gagné !' : 'Pari perdu'}
                                    </p>
                                    {n.tournamentName && (
                                      <p className="text-[11px] text-[#6b6488] truncate">{n.tournamentName}</p>
                                    )}
                                    <p className="text-[12px] text-[#9988bb] mt-0.5">
                                      {n.playerBetOn} · Mise {n.amount} ⚜
                                      {n.won && <span className="text-[#f5c842] font-bold"> → +{n.payout} ⚜</span>}
                                    </p>
                                    <p className="text-[10px] text-[#4a4468] mt-0.5">
                                      {new Date(n.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                  </div>
                                </div>
                              );
                            }
                            // system notifications: tip, deposit, withdrawal
                            const icon = n.type === 'tip' ? '🎁' : n.type === 'deposit' ? '💰' : '💸';
                            const title = n.type === 'tip'
                              ? `Tip reçu de ${n.from ?? '?'}`
                              : n.type === 'deposit' ? 'Dépôt confirmé' : 'Retrait traité';
                            const color = n.type === 'withdrawal' ? 'text-[#f87171]' : 'text-[#4ade80]';
                            return (
                              <div key={n.id} className={`px-4 py-3 flex items-start gap-3 ${n.read ? 'opacity-60' : ''}`}>
                                <span className="text-lg mt-0.5 shrink-0">{icon}</span>
                                <div className="flex-1 min-w-0">
                                  <p className={`text-[13px] font-semibold ${color}`}>{title}</p>
                                  <p className="text-[12px] text-[#f5c842] font-bold mt-0.5">+{n.amount} ⚜</p>
                                  <p className="text-[10px] text-[#4a4468] mt-0.5">
                                    {new Date(n.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                                  </p>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* User dropdown — avatar + coins + name */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className="flex items-center gap-0 rounded border border-aoe-border bg-aoe-stone/30 hover:border-aoe-border-gold transition-colors h-9 overflow-hidden"
                >
                  {/* Coins badge */}
                  <div className="flex items-center gap-1.5 px-3 h-full border-r border-aoe-border"
                    style={{ background: 'rgba(212,160,23,0.08)' }}>
                    <Wallet size={12} className="text-aoe-gold" />
                    <span className={cn(
                      'font-bold font-cinzel text-sm tabular-nums transition-colors duration-300',
                      coinFlash === 'up' ? 'text-green-400 drop-shadow-[0_0_8px_rgba(74,222,128,0.9)]' :
                      coinFlash === 'down' ? 'text-red-400 drop-shadow-[0_0_8px_rgba(248,113,113,0.9)]' :
                      'text-aoe-gold'
                    )}>
                      {new Intl.NumberFormat('fr-FR').format(displayCoins)} ⚜
                    </span>
                  </div>
                  {/* Avatar + name */}
                  <div className="flex items-center gap-2 px-2.5">
                    <Avatar className="w-6 h-6">
                      {session.user.image ? (
                        <AvatarImage src={session.user.image} alt="Avatar" />
                      ) : null}
                      <AvatarFallback className="text-[10px]">
                        {(session.user.name || 'U').slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-aoe-parchment text-sm font-medium max-w-[80px] truncate hidden sm:block">
                      {session.user.name}
                    </span>
                    <ChevronDown size={12} className="text-aoe-parchment-dim" />
                  </div>
                </button>

                {dropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setDropdownOpen(false)}
                    />
                    <div className="absolute right-0 top-full mt-2 w-48 border border-aoe-border bg-aoe-bg-card shadow-xl z-20 py-1 rounded-md">
                      <div className="px-4 py-2 border-b border-aoe-border mb-1">
                        <p className="text-xs text-aoe-parchment-dim font-cinzel tracking-wide truncate">
                          {session.user.name}
                        </p>
                        <p className="text-xs text-aoe-gold font-cinzel font-bold mt-0.5">
                          ⚜ {new Intl.NumberFormat('fr-FR').format(displayCoins)} coins
                        </p>
                        <p className="text-[10px] text-[#6b6488] mt-0.5">
                          ≈ ${(displayCoins / 1.69).toFixed(2)}
                        </p>
                      </div>
                      <Link
                        href="/profile"
                        className="flex items-center gap-2 px-4 py-2 text-sm text-aoe-parchment hover:bg-aoe-stone transition-colors"
                        onClick={() => setDropdownOpen(false)}
                      >
                        <User size={14} className="text-aoe-gold" />
                        {t('auth_my_profile')}
                      </Link>
                      {session.user.isAdmin && (
                        <Link
                          href="/admin"
                          className="flex items-center gap-2 px-4 py-2 text-sm text-aoe-parchment hover:bg-aoe-stone transition-colors"
                          onClick={() => setDropdownOpen(false)}
                        >
                          <Shield size={14} className="text-aoe-crimson-bright" />
                          {t('nav_admin')}
                        </Link>
                      )}
                      <div className="border-t border-aoe-border my-1" />
                      <button
                        onClick={() => { signOut(); setDropdownOpen(false); }}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-aoe-parchment-dim hover:bg-aoe-stone hover:text-aoe-parchment transition-colors w-full text-left"
                      >
                        <LogOut size={14} />
                        {t('auth_signout')}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </>
          ) : (
            <Button
              variant="steam"
              size="sm"
              onClick={handleSteamLogin}
              className="flex items-center gap-2 text-sm h-9"
            >
              <SteamIcon />
              <span className="hidden sm:inline">{t('auth_signin_steam')}</span>
              <span className="sm:hidden">Steam</span>
            </Button>
          )}
        </div>
      </div>
    </nav>
    </>
  );
}
