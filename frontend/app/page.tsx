'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { Match, Tournament } from '@/types';
import { getMatches, placeBet, getTournaments } from '@/lib/api';
import { Particles } from '@/components/magicui/particles';
import { GridPattern } from '@/components/magicui/grid-pattern';
import { Meteors } from '@/components/magicui/meteors';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Zap, Clock, TrendingUp, ChevronRight, Swords, Trophy,
  RefreshCw, AlertTriangle, Users, Crown, Minus, Plus, Lock, Tv,
} from 'lucide-react';

// ── Helpers ───────────────────────────────────────────────────────────────────
function getCountryFlag(code?: string | null): string {
  if (!code) return '';
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1e0 - 65 + c.charCodeAt(0)));
}

function formatCountdown(dateStr: string, t: (k: string) => string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return t('matches_imminent');
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m} min`;
}

function getTierClass(tier?: string): string {
  switch (tier) {
    case 'S': return 'badge-tier-s';
    case 'A': return 'badge-tier-a';
    case 'B': return 'badge-tier-b';
    default:  return 'badge-tier-c';
  }
}

// ── Player Avatar ─────────────────────────────────────────────────────────────
function PlayerAvatar({
  name,
  avatarUrl,
  size = 56,
  selected = false,
}: {
  name: string;
  avatarUrl?: string | null;
  size?: number;
  selected?: boolean;
}) {
  const initials = name.slice(0, 2).toUpperCase();
  const hue = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % 360;

  return (
    <div
      className={cn(
        'rounded-full flex items-center justify-center relative overflow-hidden shrink-0 transition-all duration-200',
        selected && 'ring-2 ring-aoe-gold ring-offset-2 ring-offset-[#0d0b1a]'
      )}
      style={{
        width: size,
        height: size,
        background: avatarUrl
          ? undefined
          : `radial-gradient(circle at 40% 35%, hsl(${hue},35%,22%) 0%, hsl(${hue},20%,10%) 100%)`,
        border: selected
          ? '2px solid rgba(212,160,23,0.6)'
          : '2px solid rgba(212,160,23,0.18)',
        boxShadow: selected ? `0 0 18px rgba(212,160,23,0.3)` : 'none',
      }}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: size * 0.65, height: size * 0.65 }}>
          <circle cx="12" cy="8" r="4" fill={`hsl(${hue},45%,55%)`} />
          <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8" fill={`hsl(${hue},35%,40%)`} />
        </svg>
      )}
    </div>
  );
}

// ── Quick Bet Bar ─────────────────────────────────────────────────────────────
function QuickBetBar({
  match,
  selectedPlayer,
  onClose,
}: {
  match: Match;
  selectedPlayer: 1 | 2;
  onClose: () => void;
}) {
  const { t } = useT();
  const { data: session } = useSession();
  const [amount, setAmount] = useState(100);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);
  const [errMsg, setErrMsg] = useState('');

  const odds = selectedPlayer === 1 ? match.odds1 : match.odds2;
  const potential = Math.floor(amount * odds);
  const player = selectedPlayer === 1 ? match.player1 : match.player2;

  const handleBet = async () => {
    if (!session) return;
    setLoading(true);
    try {
      await placeBet(match.id, amount, selectedPlayer);
      setResult('success');
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : t('common_error'));
      setResult('error');
    } finally {
      setLoading(false);
    }
  };

  if (!session) {
    return (
      <div className="animate-slide-down border-t border-aoe-border/50 bg-black/30 px-4 py-3">
        <p className="text-center text-aoe-parchment-dim text-xs font-cinzel tracking-wider">
          <span className="text-aoe-gold">{t('auth_required')}</span> {t('bet_signin_desc')}
        </p>
      </div>
    );
  }

  if (result === 'success') {
    return (
      <div className="animate-slide-down border-t border-emerald-500/30 bg-emerald-950/20 px-4 py-3 flex items-center justify-between">
        <p className="text-emerald-400 text-xs font-cinzel tracking-wider">
          {t('bet_success').replace('{amount}', String(amount))} {t('bet_potential')}: {potential.toLocaleString('fr-FR')} ⚜
        </p>
        <button onClick={onClose} className="text-aoe-parchment-muted hover:text-aoe-parchment text-xs">✕</button>
      </div>
    );
  }

  if (result === 'error') {
    return (
      <div className="animate-slide-down border-t border-red-500/30 bg-red-950/20 px-4 py-3 flex items-center justify-between">
        <p className="text-red-400 text-xs font-cinzel">{errMsg}</p>
        <button onClick={() => setResult(null)} className="text-aoe-parchment-muted hover:text-aoe-parchment text-xs">{t('common_retry')}</button>
      </div>
    );
  }

  return (
    <div className="animate-slide-down border-t border-aoe-gold/20 bg-black/40 px-4 py-3">
      <div className="flex items-center gap-3">
        {/* Player indicator */}
        <div className="flex items-center gap-1.5 shrink-0">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: '#d4a017' }}
          />
          <span className="text-[10px] font-cinzel tracking-wider text-aoe-gold uppercase truncate max-w-[80px]">
            {player.name}
          </span>
        </div>

        {/* Amount stepper */}
        <div className="flex items-center gap-1 flex-1">
          <button
            onClick={() => setAmount((a) => Math.max(10, a - 50))}
            className="w-6 h-6 rounded bg-aoe-stone border border-aoe-border flex items-center justify-center hover:border-aoe-gold/40 transition-colors"
          >
            <Minus size={10} className="text-aoe-parchment-dim" />
          </button>
          <input
            type="number"
            min={10}
            max={500}
            value={amount}
            onChange={(e) => setAmount(Math.min(500, Math.max(10, parseInt(e.target.value) || 10)))}
            className="aom-input text-center text-sm font-bold font-cinzel h-6 w-16 px-1"
          />
          <button
            onClick={() => setAmount((a) => Math.min(500, a + 50))}
            className="w-6 h-6 rounded bg-aoe-stone border border-aoe-border flex items-center justify-center hover:border-aoe-gold/40 transition-colors"
          >
            <Plus size={10} className="text-aoe-parchment-dim" />
          </button>
        </div>

        {/* Potential */}
        <div className="text-right shrink-0">
          <p className="text-[9px] text-aoe-parchment-muted font-cinzel tracking-wider uppercase">{t('bet_potential')}</p>
          <p className="text-aoe-gold font-bold font-cinzel text-sm text-glow-gold">
            {potential.toLocaleString('fr-FR')} ⚜
          </p>
        </div>

        {/* Bet button */}
        <button
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleBet(); }}
          disabled={loading}
          className="aom-btn-gold btn-shimmer text-[10px] px-3 py-2 shrink-0 h-8 disabled:opacity-50"
        >
          {loading ? <RefreshCw size={11} className="animate-spin" /> : t('bet_submit')}
        </button>
      </div>
    </div>
  );
}

// ── Civ display helper ────────────────────────────────────────────────────────
function formatCiv(civ?: string | null): string {
  if (!civ) return '';
  return civ.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Match Card ────────────────────────────────────────────────────────────────
function MatchCard({ match }: { match: Match }) {
  const { t } = useT();
  const router = useRouter();
  const [selected, setSelected] = useState<1 | 2 | null>(null);
  const isLive      = match.status === 'LIVE';
  const isCompleted = match.status === 'COMPLETED';
  const vol = match.betVolume ?? { pct1: 50, pct2: 50, total: 0 };
  const betsLocked = match.betsOpen === false;
  const gameOngoing = betsLocked && isLive;
  const twitchChannel = match.twitchChannel ?? match.tournament?.twitchChannel ?? null;
  const p1Won = isCompleted && !!match.winnerId && match.winnerId === match.player1Id;
  const p2Won = isCompleted && !!match.winnerId && match.winnerId === match.player2Id;

  const handleOddsClick = (player: 1 | 2, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected((s) => (s === player ? null : player));
  };

  const handleCardClick = () => {
    if (!isCompleted) router.push(`/matches/${match.id}`);
  };

  return (
    <div
      onClick={handleCardClick}
      className={cn('match-card group', isLive && 'match-card-live', !isCompleted && 'cursor-pointer')}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-aoe-border/60"
        style={{ background: 'rgba(0,0,0,0.35)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={getTierClass(match.tournament?.tier)}>
            {match.tournament?.tier ?? 'C'}
          </span>
          <span className={cn(
            'text-[10px] font-cinzel tracking-wider border rounded px-1.5 py-0.5',
            match.game === 'AoE2' ? 'text-red-400 border-red-400/40 bg-red-400/10' :
            match.game === 'AoM' ? 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10' :
            match.game === 'AoE3' ? 'text-blue-400 border-blue-400/40 bg-blue-400/10' :
            match.game === 'AoE1' ? 'text-orange-400 border-orange-400/40 bg-orange-400/10' :
            'text-aoe-gold border-aoe-gold/40 bg-aoe-gold/10'
          )}>
            {match.game || 'AoE4'}
          </span>
          <span className="text-aoe-parchment-dim text-xs truncate max-w-[180px]">
            {match.tournament?.name ?? 'Tournoi'}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {twitchChannel && (
            <a
              href={`https://twitch.tv/${twitchChannel}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] font-cinzel text-purple-400 hover:text-purple-300 border border-purple-500/40 hover:border-purple-400/60 px-1.5 py-0.5 rounded transition-colors"
              title={`Regarder sur Twitch`}
            >
              <Tv size={9} />STREAM
            </a>
          )}
          {betsLocked && isLive && (
            <span className="flex items-center gap-1 text-[10px] font-cinzel text-red-400 border border-red-500/40 px-1.5 py-0.5 rounded">
              <Lock size={9} />{t('matches_bets_closed')}
            </span>
          )}
          <span className="text-[10px] font-cinzel tracking-widest text-aoe-parchment-dim border border-aoe-border/60 px-1.5 py-0.5 rounded">
            {match.format}
          </span>
          {isLive ? (
            <span className="badge-live">
              <Zap size={9} />LIVE
            </span>
          ) : isCompleted ? (
            <span className="text-[11px] text-[#6b6488] font-cinzel border border-[#2a2540] rounded px-1.5 py-0.5">
              Terminé
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[11px] text-aoe-parchment-dim">
              <Clock size={11} />
              {formatCountdown(match.scheduledAt, t)}
            </span>
          )}
        </div>
      </div>

      {/* Players area */}
      <div className="grid grid-cols-[1fr_auto_1fr]">
        {/* Player 1 */}
        <div
          className={cn('p-4 flex flex-col items-center gap-3 transition-all duration-300', p2Won && 'opacity-40')}
          style={{
            background: selected === 1
              ? 'radial-gradient(ellipse at 50% 0%, rgba(212,160,23,0.1) 0%, transparent 70%)'
              : p1Won ? 'radial-gradient(ellipse at 50% 0%, rgba(212,160,23,0.07) 0%, transparent 70%)' : 'transparent',
          }}
        >
          <div className="relative">
            <PlayerAvatar
              name={match.player1.name}
              avatarUrl={match.player1.avatarUrl}
              size={56}
              selected={selected === 1}
            />
            {p1Won && (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-3xl leading-none drop-shadow-[0_0_8px_rgba(212,160,23,0.6)]">👑</span>
            )}
          </div>
          <div className="text-center">
            <p className={cn('font-cinzel font-bold text-sm leading-tight', p1Won ? 'text-[#d4a017]' : 'text-aoe-parchment')}>
              {match.player1.name}
            </p>
            {gameOngoing && match.p1Civ && (
              <p className="text-[10px] mt-0.5 font-cinzel text-amber-400 tracking-wide">
                {formatCiv(match.p1Civ)}
              </p>
            )}
          </div>

          {/* Odds button P1 or winner label */}
          {isCompleted ? (
            <div className="w-full rounded-lg px-3 py-2.5 text-center" style={{ background: p1Won ? 'rgba(212,160,23,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${p1Won ? 'rgba(212,160,23,0.25)' : 'rgba(255,255,255,0.05)'}` }}>
              <div className={cn('font-cinzel text-[11px] font-bold uppercase tracking-widest', p1Won ? 'text-[#d4a017]' : 'text-[#3d3860]')}>
                {p1Won ? 'Vainqueur' : 'Éliminé'}
              </div>
              <div className="text-[10px] text-[#4a4570] mt-0.5 font-cinzel">
                Cote finale {match.odds1.toFixed(2)}×
              </div>
            </div>
          ) : (
            <button
              onClick={(e) => handleOddsClick(1, e)}
              className={cn('odds-btn w-full transition-all duration-200', selected === 1 && 'selected')}
              style={selected === 1 ? {
                background: 'linear-gradient(135deg, rgba(139,100,16,0.4), rgba(212,160,23,0.2))',
                borderColor: '#d4a017',
                boxShadow: '0 0 20px rgba(212,160,23,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
              } : undefined}
            >
              <div className={cn('font-cinzel font-black text-2xl leading-none', selected === 1 ? 'text-aoe-gold-bright text-glow-gold' : 'text-aoe-parchment')}>
                {match.odds1.toFixed(2)}
              </div>
              <div className="text-[9px] text-aoe-parchment-muted mt-1 uppercase tracking-widest font-cinzel">
                {match.player1.name.length > 10 ? match.player1.name.slice(0, 10) + '…' : match.player1.name}
              </div>
            </button>
          )}
        </div>

        {/* Center VS divider */}
        <div className="flex flex-col items-center justify-center py-4 gap-1 px-2">
          <div className="w-px flex-1 bg-gradient-to-b from-transparent via-aoe-border to-transparent" />
          {isCompleted ? (
            <div className="flex flex-col items-center shrink-0 gap-0.5">
              <div className={cn('font-cinzel font-black text-xl leading-none', p1Won ? 'text-[#d4a017]' : 'text-[#4a4570]')}>
                {match.p1Score ?? 0}
              </div>
              <div className="text-[#3a3560] text-[8px] font-cinzel tracking-widest">FIN</div>
              <div className={cn('font-cinzel font-black text-xl leading-none', p2Won ? 'text-[#d4a017]' : 'text-[#4a4570]')}>
                {match.p2Score ?? 0}
              </div>
            </div>
          ) : isLive && (match.p1Score !== undefined || match.p2Score !== undefined) ? (
            <div className="flex flex-col items-center shrink-0">
              <div className="text-aoe-gold font-cinzel font-black text-lg leading-none">
                {match.p1Score ?? 0}
              </div>
              <div className="text-aoe-parchment-muted text-[8px] font-cinzel tracking-widest my-0.5">VS</div>
              <div className="text-aoe-parchment font-cinzel font-black text-lg leading-none">
                {match.p2Score ?? 0}
              </div>
            </div>
          ) : (
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center border border-aoe-border-mid shrink-0"
              style={{ background: '#0d0b1a' }}
            >
              <Swords size={12} className="text-aoe-parchment-dim" />
            </div>
          )}
          <div className="w-px flex-1 bg-gradient-to-b from-aoe-border via-transparent to-transparent" />
        </div>

        {/* Player 2 */}
        <div
          className={cn('p-4 flex flex-col items-center gap-3 transition-all duration-300', p1Won && 'opacity-40')}
          style={{
            background: selected === 2
              ? 'radial-gradient(ellipse at 50% 0%, rgba(41,128,185,0.1) 0%, transparent 70%)'
              : p2Won ? 'radial-gradient(ellipse at 50% 0%, rgba(212,160,23,0.07) 0%, transparent 70%)' : 'transparent',
          }}
        >
          <div className="relative">
            <PlayerAvatar
              name={match.player2.name}
              avatarUrl={match.player2.avatarUrl}
              size={56}
              selected={selected === 2}
            />
            {p2Won && (
              <span className="absolute -top-4 left-1/2 -translate-x-1/2 text-3xl leading-none drop-shadow-[0_0_8px_rgba(212,160,23,0.6)]">👑</span>
            )}
          </div>
          <div className="text-center">
            <p className={cn('font-cinzel font-bold text-sm leading-tight', p2Won ? 'text-[#d4a017]' : 'text-aoe-parchment')}>
              {match.player2.name}
            </p>
            {gameOngoing && match.p2Civ && (
              <p className="text-[10px] mt-0.5 font-cinzel text-blue-400 tracking-wide">
                {formatCiv(match.p2Civ)}
              </p>
            )}
          </div>

          {/* Odds button P2 or winner label */}
          {isCompleted ? (
            <div className="w-full rounded-lg px-3 py-2.5 text-center" style={{ background: p2Won ? 'rgba(212,160,23,0.08)' : 'rgba(255,255,255,0.02)', border: `1px solid ${p2Won ? 'rgba(212,160,23,0.25)' : 'rgba(255,255,255,0.05)'}` }}>
              <div className={cn('font-cinzel text-[11px] font-bold uppercase tracking-widest', p2Won ? 'text-[#d4a017]' : 'text-[#3d3860]')}>
                {p2Won ? 'Vainqueur' : 'Éliminé'}
              </div>
              <div className="text-[10px] text-[#4a4570] mt-0.5 font-cinzel">
                Cote finale {match.odds2.toFixed(2)}×
              </div>
            </div>
          ) : (
            <button
              onClick={(e) => handleOddsClick(2, e)}
              className={cn('odds-btn w-full transition-all duration-200', selected === 2 && 'selected')}
              style={selected === 2 ? {
                background: 'linear-gradient(135deg, rgba(16,60,100,0.4), rgba(41,128,185,0.2))',
                borderColor: '#2980b9',
                boxShadow: '0 0 20px rgba(41,128,185,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
              } : undefined}
            >
              <div className={cn('font-cinzel font-black text-2xl leading-none', selected === 2 ? 'text-aoe-blue-bright' : 'text-aoe-parchment')}>
                {match.odds2.toFixed(2)}
              </div>
              <div className="text-[9px] text-aoe-parchment-muted mt-1 uppercase tracking-widest font-cinzel">
                {match.player2.name.length > 10 ? match.player2.name.slice(0, 10) + '…' : match.player2.name}
              </div>
            </button>
          )}
        </div>
      </div>


      {/* Quick bet bar — appears when a player is selected (not for completed matches) */}
      {selected !== null && !isCompleted && (
        <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
          <QuickBetBar
            match={match}
            selectedPlayer={selected}
            onClose={() => setSelected(null)}
          />
        </div>
      )}

      {/* Footer — more bets link */}
      {!isCompleted && (
        <div
          className="flex justify-end px-4 py-2 border-t"
          style={{ borderColor: '#1e1a30', background: 'rgba(0,0,0,0.2)' }}
          onClick={(e) => e.stopPropagation()}
        >
          <Link
            href={`/matches/${match.id}`}
            className="flex items-center gap-1 text-[11px] font-cinzel text-[#6b6488] hover:text-[#d4a017] transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            Afficher plus de paris <ChevronRight size={11} />
          </Link>
        </div>
      )}

    </div>
  );
}

// ── Skeleton Card ─────────────────────────────────────────────────────────────
function SkeletonCard() {
  return (
    <div className="match-card overflow-hidden">
      <div className="h-10 border-b border-aoe-border/40 bg-black/20 flex items-center px-4 gap-2">
        <Skeleton className="h-4 w-6 rounded" />
        <Skeleton className="h-3 w-32 rounded" />
        <Skeleton className="h-4 w-10 rounded ml-auto" />
      </div>
      <div className="grid grid-cols-2 gap-0">
        {[1, 2].map((i) => (
          <div key={i} className="p-4 flex flex-col items-center gap-3">
            <Skeleton className="w-14 h-14 rounded-full" />
            <Skeleton className="h-3 w-20 rounded" />
            <Skeleton className="h-3 w-14 rounded" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </div>
        ))}
      </div>
      <div className="h-10 border-t border-aoe-border/40 bg-black/10 px-4 flex items-center gap-2">
        <Skeleton className="h-2 w-8 rounded" />
        <Skeleton className="h-1.5 flex-1 rounded-full" />
        <Skeleton className="h-2 w-8 rounded" />
      </div>
    </div>
  );
}

// ── Hero ──────────────────────────────────────────────────────────────────────
function Hero({ liveCount, totalBets, matchCount }: { liveCount: number; totalBets: number; matchCount: number }) {
  const { t } = useT();
  return (
    <div
      className="relative overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #04030a 0%, #07060f 30%, #0d0b1a 60%, #07060f 100%)',
        minHeight: 260,
      }}
    >
      {/* Particles layer */}
      <Particles
        className="absolute inset-0 pointer-events-none"
        quantity={60}
        color="#d4a017"
        staticity={60}
        ease={60}
        size={0.5}
      />

      {/* Grid pattern overlay */}
      <GridPattern
        className="opacity-[0.03]"
        style={{ stroke: '#d4a017' }}
        width={48}
        height={48}
      />

      {/* Meteors */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <Meteors number={8} />
      </div>

      {/* Central radial glow */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: '-30%', left: '50%', transform: 'translateX(-50%)',
          width: 800, height: 500,
          background: 'radial-gradient(ellipse, rgba(212,160,23,0.06) 0%, transparent 60%)',
        }}
      />

      {/* Top gold line */}
      <div
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent 0%, #d4a017 30%, #f5c842 50%, #d4a017 70%, transparent 100%)' }}
      />

      {/* Castle silhouette — subtle background */}
      <div className="absolute bottom-0 left-0 right-0 pointer-events-none" style={{ opacity: 0.03 }}>
        <svg viewBox="0 0 1200 100" preserveAspectRatio="xMidYMax meet" fill="#d4a017" xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: 100 }}>
          <rect x="0" y="60" width="1200" height="40" />
          {Array.from({ length: 80 }).map((_, i) => (
            <rect key={i} x={i * 15} y="46" width="9" height="16" />
          ))}
          <rect x="80" y="14" width="80" height="48" />
          <rect x="500" y="0" width="100" height="62" />
          <rect x="1040" y="14" width="80" height="48" />
          {[90,104,118,132].map((x) => <rect key={x} x={x} y="4" width="9" height="12" />)}
          {[510,524,538,552,566,580].map((x) => <rect key={x} x={x} y="-8" width="9" height="12" />)}
          {[1050,1064,1078,1092,1106].map((x) => <rect key={x} x={x} y="4" width="9" height="12" />)}
          <rect x="544" y="30" width="44" height="32" fill="#07060f" />
        </svg>
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center py-14 px-6 text-center">
        {/* Crown */}
        <div className="mb-5 relative">
          <Crown size={44} className="text-aoe-gold drop-shadow-[0_0_16px_rgba(212,160,23,0.7)]" />
        </div>

        {/* Title */}
        <h1
          className="font-cinzel font-black tracking-[0.15em] leading-none mb-1"
          style={{ fontSize: 'clamp(26px, 5vw, 52px)' }}
        >
          <span
            style={{
              background: 'linear-gradient(135deg, #8b6410, #d4a017 30%, #f5c842 50%, #d4a017 70%, #8b6410)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}
          >
            AGEOFMONEY
          </span>
        </h1>

        {/* Animated gold underline */}
        <div
          className="mb-5 h-0.5 rounded-full"
          style={{
            width: 'clamp(160px, 40%, 340px)',
            background: 'linear-gradient(90deg, transparent, #8b6410, #d4a017, #f5c842, #d4a017, #8b6410, transparent)',
            backgroundSize: '200% auto',
            animation: 'shimmer 3s linear infinite',
          }}
        />

        <p className="text-aoe-parchment-dim text-sm tracking-wide max-w-sm mb-8 leading-relaxed">
          {t('home_hero_sub')}
        </p>

        {/* Stats row */}
        <div className="flex items-center gap-0 flex-wrap justify-center">
          <div
            className="flex items-center gap-2 px-5 py-2.5 font-cinzel tracking-wide text-xs"
            style={{ borderRight: '1px solid #1e1a30' }}
          >
            <Zap size={12} className="text-aoe-crimson-bright" />
            <span className="text-aoe-crimson-bright font-bold">{liveCount}</span>
            <span className="text-aoe-parchment-dim">{t('matches_filter_live')}</span>
          </div>
          <div
            className="flex items-center gap-2 px-5 py-2.5 font-cinzel tracking-wide text-xs"
            style={{ borderRight: '1px solid #1e1a30' }}
          >
            <TrendingUp size={12} className="text-aoe-gold" />
            <span className="text-aoe-gold font-bold">{new Intl.NumberFormat('fr-FR').format(totalBets)}</span>
            <span className="text-aoe-parchment-dim">⚜ {t('lb_wagered').toLowerCase()}</span>
          </div>
          <div className="flex items-center gap-2 px-5 py-2.5 font-cinzel tracking-wide text-xs">
            <Trophy size={12} className="text-aoe-blue-bright" />
            <span className="text-aoe-blue-bright font-bold">{matchCount}</span>
            <span className="text-aoe-parchment-dim">{t('nav_matches').toLowerCase()}</span>
          </div>
        </div>
      </div>

      {/* Bottom fade */}
      <div
        className="absolute bottom-0 left-0 right-0 h-12 pointer-events-none"
        style={{ background: 'linear-gradient(to bottom, transparent, #07060f)' }}
      />
    </div>
  );
}

// ── Filter IDs (labels generated inside component via t()) ────────────────────
const FILTER_IDS = [
  { id: 'all',       key: 'matches_filter_all' },
  { id: 'LIVE',      key: 'matches_filter_live',     dot: true },
  { id: 'UPCOMING',  key: 'matches_filter_upcoming' },
  { id: 'COMPLETED', key: 'matches_filter_done' },
] as const;

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HomePage() {
  const { t } = useT();
  const [matches, setMatches]         = useState<Match[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [filter, setFilter]           = useState('all');
  const [lastFetch, setLastFetch]     = useState<Date | null>(null);
  const [upcomingTourneys, setUpcomingTourneys] = useState<Tournament[]>([]);

  const FILTERS = FILTER_IDS.map((f) => ({ ...f, label: t(f.key) }));

  const fetchMatches = useCallback(async () => {
    try {
      setError(null);
      const [matchRes, tournRes] = await Promise.allSettled([
        getMatches({ hours: 168 }),
        getTournaments({ active: true, limit: 20 }),
      ]);
      if (matchRes.status === 'fulfilled') { setMatches(matchRes.value.data); setLastFetch(new Date()); }
      if (tournRes.status === 'fulfilled') {
        const now = Date.now();
        const future = (tournRes.value.data ?? []).filter((tourn: Tournament) => {
          // Only tier S and A
          if (tourn.tier !== 'S' && tourn.tier !== 'A') return false;
          const start = new Date(tourn.startDate).getTime();
          // If has endDate: keep only if not ended yet (ongoing)
          if (tourn.endDate) return new Date(tourn.endDate).getTime() >= now;
          // No endDate: keep only if starts in the future
          return start > now;
        });
        setUpcomingTourneys(future);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common_error'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatches();
    // Fallback polling every 30s (socket handles real-time, this is safety net)
    const interval = setInterval(fetchMatches, 30_000);
    return () => clearInterval(interval);
  }, [fetchMatches]);

  // Socket: real-time match updates (status, odds, scores)
  useEffect(() => {
    const { getSocket, connectSocket } = require('@/lib/socket');
    connectSocket();
    const s = getSocket();

    const handleMatchUpdate = (data: {
      matchId: string;
      status?: string;
      odds1?: number;
      odds2?: number;
      betsOpen?: boolean;
      p1Score?: number;
      p2Score?: number;
      p1Civ?: string;
      p2Civ?: string;
    }) => {
      setMatches((prev) =>
        prev.map((m) => {
          if (m.id !== data.matchId) return m;
          // If status changed to COMPLETED/CANCELLED, refetch to get full data
          if (data.status === 'COMPLETED' || data.status === 'CANCELLED') {
            fetchMatches();
            return m;
          }
          return {
            ...m,
            ...(data.status !== undefined ? { status: data.status as Match['status'] } : {}),
            ...(data.odds1 !== undefined ? { odds1: data.odds1 } : {}),
            ...(data.odds2 !== undefined ? { odds2: data.odds2 } : {}),
            ...(data.betsOpen !== undefined ? { betsOpen: data.betsOpen } : {}),
            ...(data.p1Score !== undefined ? { p1Score: data.p1Score } : {}),
            ...(data.p2Score !== undefined ? { p2Score: data.p2Score } : {}),
            ...(data.p1Civ !== undefined ? { p1Civ: data.p1Civ } : {}),
            ...(data.p2Civ !== undefined ? { p2Civ: data.p2Civ } : {}),
          };
        })
      );
      setLastFetch(new Date());
    };

    s.on('matchUpdate', handleMatchUpdate);
    return () => s.off('matchUpdate', handleMatchUpdate);
  }, [fetchMatches]);

  const filtered = (filter === 'all' ? matches : matches.filter((m) => m.status === filter))
    .slice()
    .sort((a, b) => {
      // Completed matches always go last
      if (a.status === 'COMPLETED' && b.status !== 'COMPLETED') return 1;
      if (b.status === 'COMPLETED' && a.status !== 'COMPLETED') return -1;
      return 0;
    });
  const liveMatches    = matches.filter((m) => m.status === 'LIVE');
  const upcomingCount  = matches.filter((m) => m.status === 'UPCOMING').length;
  const totalBetVolume = matches.reduce((acc, m) => acc + (m.betVolume?.total ?? 0), 0);

  return (
    <div className="min-h-full">
      {/* Hero */}
      <Hero liveCount={liveMatches.length} totalBets={totalBetVolume} matchCount={matches.length} />

      <div className="px-5 py-6">
        {/* Section header + filters */}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="font-cinzel font-bold text-base tracking-[0.2em] text-aoe-gold uppercase">
              {t('nav_matches')}
            </h2>
            {!loading && (
              <span className="text-[11px] text-aoe-parchment-muted font-cinzel">
                {t('n_results', { n: filtered.length, s: filtered.length !== 1 ? 's' : '' })}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Filter tabs — gold active state */}
            <div
              className="flex items-center gap-0.5 p-1 rounded-lg border border-aoe-border"
              style={{ background: 'rgba(0,0,0,0.4)' }}
            >
              {FILTERS.map((f) => {
                const isActive = filter === f.id;
                return (
                  <button
                    key={f.id}
                    onClick={() => setFilter(f.id)}
                    className={cn(
                      'relative flex items-center gap-1 px-3 py-1 text-[11px] font-cinzel tracking-wider uppercase rounded transition-all duration-150',
                      isActive
                        ? 'text-aoe-bg font-bold shadow-sm'
                        : 'text-aoe-parchment-dim hover:text-aoe-parchment hover:bg-white/5'
                    )}
                    style={isActive ? {
                      background: 'linear-gradient(135deg, #8b6410, #d4a017)',
                    } : undefined}
                  >
                    {f.id === 'LIVE' && liveMatches.length > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-aoe-crimson-bright inline-block animate-pulse-live" />
                    )}
                    {f.label}
                    {f.id === 'UPCOMING' && upcomingCount > 0 && !isActive && (
                      <span className="text-[9px] bg-aoe-border-mid px-1 py-0.5 rounded-full font-sans font-normal tracking-normal">
                        {upcomingCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Refresh button */}
            <button
              onClick={fetchMatches}
              disabled={loading}
              className="p-1.5 rounded border border-aoe-border text-aoe-parchment-muted hover:text-aoe-gold hover:border-aoe-border-mid transition-colors"
              title={lastFetch ? t('common_updated_at', { time: lastFetch.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) }) : t('common_refresh')}
            >
              <RefreshCw size={13} className={loading ? 'animate-spin text-aoe-gold' : ''} />
            </button>
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-aoe-crimson/30 bg-aoe-crimson-dim/20 p-4 mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-aoe-crimson-bright shrink-0" />
              <p className="text-aoe-crimson-bright text-sm">{error}</p>
            </div>
            <button onClick={fetchMatches} className="text-xs text-aoe-parchment-dim hover:text-aoe-parchment underline shrink-0">
              {t('common_retry')}
            </button>
          </div>
        )}

        {/* Match grid */}
        {loading ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : filtered.length > 0 ? (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {filtered.map((match) => (
              <MatchCard key={match.id} match={match} />
            ))}
          </div>
        ) : (
          /* Empty state */
          <div className="flex flex-col items-center py-8">
            <Swords size={28} className="text-aoe-parchment-muted opacity-40 mb-4" />
            <p className="font-cinzel text-sm tracking-widest text-aoe-parchment-dim mb-2">
              {filter !== 'all' ? t('matches_empty_filter') : t('matches_empty')}
            </p>
            {filter !== 'all' && (
              <button onClick={() => setFilter('all')} className="text-xs text-aoe-gold font-cinzel hover:underline">
                {t('home_view_all')}
              </button>
            )}
          </div>
        )}

        {/* Upcoming tournaments — always shown when no UPCOMING matches exist */}
        {!loading && upcomingCount === 0 && upcomingTourneys.length > 0 && (
          <div className="mt-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="font-cinzel font-bold text-base tracking-[0.2em] text-aoe-gold uppercase">
                Prochains Tournois
              </h2>
              <span className="text-[11px] text-aoe-parchment-muted font-cinzel">{upcomingTourneys.length} tournoi{upcomingTourneys.length > 1 ? 's' : ''}</span>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {upcomingTourneys.map(tourn => (
                <Link key={tourn.id} href={`/tournaments/${tourn.id}`}
                  className="flex items-center gap-4 px-5 py-4 rounded-xl border border-[#1e1a30] hover:border-[#d4a017]/30 transition-all group"
                  style={{ background: '#0d0b1a' }}>
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(212,160,23,0.08)', border: '1px solid rgba(212,160,23,0.15)' }}>
                    <Trophy size={16} className="text-[#d4a017]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-cinzel font-bold text-[13px] text-[#e8e2f5] truncate group-hover:text-[#d4a017] transition-colors">{tourn.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-[#6b6488]">{tourn.game ?? 'AoE4'}</span>
                      {tourn.startDate && <span className="text-[10px] text-[#6b6488]">· {new Date(tourn.startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>}
                      {tourn.endDate && <span className="text-[10px] text-[#6b6488]">→ {new Date(tourn.endDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>}
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded shrink-0"
                    style={{ background: tourn.tier === 'S' ? '#d4a01720' : tourn.tier === 'A' ? '#a78bfa20' : '#60a5fa20',
                             color: tourn.tier === 'S' ? '#d4a017' : tourn.tier === 'A' ? '#a78bfa' : '#60a5fa' }}>
                    {tourn.tier}
                  </span>
                  <ChevronRight size={14} className="text-[#3d3860] group-hover:text-[#d4a017] transition-colors shrink-0" />
                </Link>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
