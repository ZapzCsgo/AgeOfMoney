'use client';

import { LucideIcon } from 'lucide-react';
import { signInWithSteam } from '@/lib/authHelpers';
import { useT } from '@/lib/i18n';

function SteamIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
      <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z" />
    </svg>
  );
}

interface Props {
  icon: LucideIcon;
  description: string;
  /** Defaults to the current path so the user lands back where they came from. */
  returnTo?: string;
}

/**
 * Shared "sign in to continue" screen for pages that are fully gated behind
 * auth (deposit/withdraw/profile). Previously each page hand-rolled a
 * slightly different version of this (different card padding, some with an
 * icon halo and gold divider, some without, one full-viewport-centered
 * instead of a card) — that drift between pages, not any single page's
 * colors, was what read as "doesn't match the rest of the site."
 */
export function AuthRequiredState({ icon: Icon, description, returnTo }: Props) {
  const { t } = useT();

  return (
    <div className="max-w-md mx-auto px-4 py-16 text-center">
      <div className="relative rounded-2xl border overflow-hidden p-10" style={{ background: '#0d0b1a', borderColor: '#2d2850' }}>
        {/* Subtle gold glow, same treatment as the homepage hero */}
        <div
          className="absolute pointer-events-none"
          style={{
            top: '-40%', left: '50%', transform: 'translateX(-50%)',
            width: 420, height: 260,
            background: 'radial-gradient(ellipse, rgba(255,197,66,0.08) 0%, transparent 65%)',
          }}
          aria-hidden
        />
        <div className="h-px mb-8 relative" style={{ background: 'linear-gradient(90deg,transparent,#ffc542 30%,#ffd97a 50%,#ffc542 70%,transparent)' }} />

        <div className="relative mb-5 mx-auto w-fit">
          <div className="absolute inset-0 blur-2xl bg-aoe-gold/15 rounded-full scale-150" aria-hidden />
          <div className="relative w-14 h-14 rounded-full flex items-center justify-center" style={{ background: 'rgba(255,197,66,0.1)', border: '1px solid rgba(255,197,66,0.3)' }}>
            <Icon size={24} className="text-aoe-gold" strokeWidth={1.75} />
          </div>
        </div>

        <h2 className="font-cinzel font-bold text-xl text-aoe-gold mb-2 tracking-wider">
          {t('auth_required').toUpperCase()}
        </h2>
        <p className="text-aoe-parchment-dim text-sm mb-8 leading-relaxed">
          {description}
        </p>

        <button
          onClick={() => signInWithSteam(returnTo)}
          className="relative w-full flex items-center justify-center gap-3 py-4 rounded-xl font-bold text-base transition-all hover:brightness-110 active:scale-[0.99]"
          style={{ background: 'linear-gradient(135deg, #2a475e, #1b2838)', border: '1px solid #4c6b8a', color: 'white' }}
        >
          <SteamIcon />
          {t('auth_signin_steam')}
        </button>
      </div>
    </div>
  );
}
