'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useT } from '@/lib/i18n';
import { Match, BoResult, Bet } from '@/types';
import { getMatch, getMatchH2H, getMyBets, setAuthToken } from '@/lib/api';
import { BetForm } from '@/components/matches/BetForm';
import { PlayerStats } from '@/components/matches/PlayerStats';
import { MatchChat } from '@/components/matches/MatchChat';
import { connectSocket, getSocket } from '@/lib/socket';
import { formatDateTime, formatCountdown, getTierBadgeClass, getCountryFlag } from '@/lib/utils';
import {
  ArrowLeft, Calendar, Zap, Lock, Tv, Shield, Swords, Receipt, TrendingUp, Clock,
} from 'lucide-react';
import Link from 'next/link';
import { cn, getAvatarSrc } from '@/lib/utils';

// ── My bets on this match ─────────────────────────────────────────────────────
function MyMatchBets({ matchId, match, refreshKey }: { matchId: string; match: Match; refreshKey: number }) {
  const { t } = useT();
  const { data: session } = useSession();
  const [bets, setBets] = useState<Bet[]>([]);

  useEffect(() => {
    if (!session?.user?.accessToken) return;
    setAuthToken(session.user.accessToken);
    getMyBets({ limit: 50 })
      .then((res) => {
        const matchBets = res.data.filter((b) => b.matchId === matchId);
        setBets(matchBets);
      })
      .catch(() => {});
  }, [matchId, session, refreshKey]);

  if (!session || bets.length === 0) return null;

  return (
    <div className="aoe-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Receipt size={13} className="text-aoe-gold" />
        <h4 className="font-cinzel font-bold text-xs text-aoe-gold tracking-wider uppercase">
          Mes paris
        </h4>
        <span className="ml-auto text-[10px] text-aoe-parchment-muted font-cinzel">
          {bets.length} pari{bets.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="space-y-2">
        {bets.map((bet) => {
          const playerName = bet.selectedPlayer === 1 ? match.player1.name : match.player2.name;
          const potentialReturn = parseFloat((bet.amount * bet.oddsAtBet).toFixed(2));
          const statusColor =
            bet.status === 'WON'      ? 'text-emerald-400' :
            bet.status === 'LOST'     ? 'text-red-400' :
            bet.status === 'REFUNDED' ? 'text-blue-400' :
            'text-aoe-parchment-dim';
          const statusLabel =
            bet.status === 'WON'      ? '✓ Gagné' :
            bet.status === 'LOST'     ? '✗ Perdu' :
            bet.status === 'REFUNDED' ? '↩ Remboursé' :
            '⏳ En attente';

          return (
            <div
              key={bet.id}
              className="rounded-lg p-3 space-y-1.5"
              style={{
                background: bet.status === 'WON'
                  ? 'rgba(16,185,129,0.06)'
                  : bet.status === 'LOST'
                  ? 'rgba(220,38,38,0.06)'
                  : 'rgba(255,255,255,0.03)',
                border: `1px solid ${
                  bet.status === 'WON'  ? 'rgba(16,185,129,0.2)' :
                  bet.status === 'LOST' ? 'rgba(220,38,38,0.2)' :
                  'rgba(255,255,255,0.06)'
                }`,
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-cinzel font-bold text-xs text-aoe-parchment truncate">{playerName}</span>
                <span className={cn('text-[10px] font-cinzel font-bold shrink-0 ml-2', statusColor)}>
                  {statusLabel}
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-aoe-parchment-muted">Mise</span>
                <span className="text-aoe-parchment font-semibold">{bet.amount.toFixed(2)} ⚜</span>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-aoe-parchment-muted">Cote</span>
                <span className="text-aoe-gold font-cinzel">× {bet.oddsAtBet.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between text-[11px] border-t border-white/5 pt-1.5">
                <span className="text-aoe-parchment-muted">
                  {bet.status === 'WON' ? 'Gain reçu' : 'Gain potentiel'}
                </span>
                <span className={cn('font-cinzel font-bold', bet.status === 'WON' ? 'text-emerald-400' : 'text-aoe-parchment')}>
                  {bet.status === 'WON' && bet.payout
                    ? `+${bet.payout.toFixed(2)} ⚜`
                    : `${potentialReturn.toFixed(2)} ⚜`}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatCiv(civ?: string | null): string {
  if (!civ) return '';
  return civ.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDuration(seconds?: number | null): string {
  if (!seconds) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ── Player avatar ─────────────────────────────────────────────────────────────
function PlayerAvatar({ name, playerId, avatarUrl, size = 64 }: { name: string; playerId?: string; avatarUrl?: string | null; size?: number }) {
  const hue = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  const imgSrc = playerId ? getAvatarSrc(playerId, avatarUrl) : avatarUrl;
  return (
    <div
      className="rounded-full overflow-hidden shrink-0 flex items-center justify-center"
      style={{
        width: size, height: size,
        background: imgSrc ? undefined : `radial-gradient(circle, hsl(${hue},30%,20%), hsl(${hue},20%,10%))`,
        border: '2px solid rgba(212,160,23,0.3)',
      }}
    >
      {imgSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={imgSrc} alt={name} className="w-full h-full object-cover" />
      ) : (
        <svg viewBox="0 0 24 24" fill="none" style={{ width: size * 0.65, height: size * 0.65 }}>
          <circle cx="12" cy="8" r="4" fill={`hsl(${hue},45%,55%)`} />
          <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8" fill={`hsl(${hue},35%,40%)`} />
        </svg>
      )}
    </div>
  );
}

// ── BO History row ────────────────────────────────────────────────────────────
function BoHistoryCard({ bo, p1Name, p2Name, p1Id }: {
  bo: BoResult;
  p1Name: string;
  p2Name: string;
  p1Id: string;
}) {
  const p1Won = bo.winnerId === p1Id;
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <span className="text-aoe-parchment-muted font-cinzel shrink-0">BO {bo.boNumber}</span>
      <div className="flex items-center gap-1.5 flex-1 min-w-0">
        <span className={cn('font-semibold truncate', p1Won ? 'text-amber-400' : 'text-aoe-parchment-dim')}>{p1Name}</span>
        {bo.p1Civ && <span className="text-[9px] text-aoe-parchment-muted truncate">({formatCiv(bo.p1Civ)})</span>}
      </div>
      <div className="font-cinzel font-black text-sm shrink-0 flex items-center gap-1">
        <span className={p1Won ? 'text-amber-400' : 'text-aoe-parchment-muted'}>
          {p1Won ? 'W' : 'L'}
        </span>
        <span className="text-aoe-parchment-muted text-[10px]">vs</span>
        <span className={!p1Won ? 'text-blue-400' : 'text-aoe-parchment-muted'}>
          {!p1Won ? 'W' : 'L'}
        </span>
      </div>
      <div className="flex items-center gap-1.5 flex-1 min-w-0 justify-end">
        {bo.p2Civ && <span className="text-[9px] text-aoe-parchment-muted truncate">({formatCiv(bo.p2Civ)})</span>}
        <span className={cn('font-semibold truncate', !p1Won ? 'text-blue-400' : 'text-aoe-parchment-dim')}>{p2Name}</span>
      </div>
      <div className="flex items-center gap-2 text-[9px] text-aoe-parchment-muted shrink-0">
        {bo.map && <span className="truncate max-w-[70px]">{bo.map}</span>}
        {bo.duration && <span>{formatDuration(bo.duration)}</span>}
      </div>
    </div>
  );
}

// ── Exact Score Bets ──────────────────────────────────────────────────────────
interface ExactScoreEntry { score: string; player: 1|2; loserGames: number; odds: number; }

function ExactScoreBets({ match, onBetPlaced }: { match: Match; onBetPlaced: () => void }) {
  const { data: session } = useSession();
  const [scores, setScores] = useState<ExactScoreEntry[]>([]);
  const [selected, setSelected] = useState<ExactScoreEntry | null>(null);
  const [amount, setAmount] = useState('10');
  const [placing, setPlacing] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok'|'err'; text: string } | null>(null);

  useEffect(() => {
    fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/bets/exact-scores/${match.id}`)
      .then(r => r.json()).then(r => setScores(r.data ?? [])).catch(() => {});
  }, [match.id]);

  const handleBet = async () => {
    if (!session?.user?.accessToken || !selected) return;
    setPlacing(true); setMsg(null);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'}/api/v1/bets/exact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.user.accessToken}` },
        body: JSON.stringify({ matchId: match.id, amount: parseInt(amount), score: selected.score, player: selected.player, loserGames: selected.loserGames, odds: selected.odds }),
      });
      const data = await res.json();
      if (!res.ok) { setMsg({ type: 'err', text: data.error ?? 'Erreur' }); return; }
      setMsg({ type: 'ok', text: `Pari placé sur ${selected.score} à ×${selected.odds}` });
      setSelected(null); setAmount('10');
      onBetPlaced();
    } catch { setMsg({ type: 'err', text: 'Erreur réseau' }); }
    finally { setPlacing(false); }
  };

  if (scores.length === 0) return null;
  const p1Scores = scores.filter(s => s.player === 1);
  const p2Scores = scores.filter(s => s.player === 2);

  return (
    <div className="aoe-card p-4 space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <Receipt size={14} className="text-aoe-gold" />
        <h3 className="font-cinzel font-bold text-sm text-aoe-gold tracking-wider uppercase">Score Exact</h3>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/* P1 scores */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-cinzel text-aoe-parchment-muted text-center mb-2 truncate">{match.player1.name}</p>
          {p1Scores.map(s => (
            <button key={s.score} onClick={() => setSelected(sel => sel?.score === s.score ? null : s)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12px] font-cinzel font-bold transition-all ${selected?.score === s.score ? 'border-[#d4a017]' : 'border-aoe-border hover:border-aoe-border-gold'}`}
              style={{ background: selected?.score === s.score ? 'rgba(212,160,23,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${selected?.score === s.score ? '#d4a017' : '#1e1a30'}` }}>
              <span className={selected?.score === s.score ? 'text-[#f5c842]' : 'text-aoe-parchment'}>{s.score}</span>
              <span className="text-aoe-gold">×{s.odds}</span>
            </button>
          ))}
        </div>
        {/* P2 scores */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-cinzel text-aoe-parchment-muted text-center mb-2 truncate">{match.player2.name}</p>
          {p2Scores.map(s => (
            <button key={s.score} onClick={() => setSelected(sel => sel?.score === s.score ? null : s)}
              className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-[12px] font-cinzel font-bold transition-all`}
              style={{ background: selected?.score === s.score ? 'rgba(41,128,185,0.15)' : 'rgba(255,255,255,0.03)', border: `1px solid ${selected?.score === s.score ? '#2980b9' : '#1e1a30'}` }}>
              <span className={selected?.score === s.score ? 'text-blue-300' : 'text-aoe-parchment'}>{s.score}</span>
              <span className="text-aoe-gold">×{s.odds}</span>
            </button>
          ))}
        </div>
      </div>

      {selected && session && (
        <div className="pt-2 border-t border-aoe-border space-y-2">
          <p className="text-[11px] text-aoe-parchment-muted font-cinzel">Score sélectionné : <span className="text-[#f5c842] font-bold">{selected.score} ×{selected.odds}</span></p>
          <div className="flex gap-2">
            <input type="text" inputMode="numeric" value={amount} onChange={e => setAmount(e.target.value.replace(/\D/g,''))}
              className="flex-1 rounded px-3 py-2 text-sm font-cinzel text-aoe-parchment outline-none"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #1e1a30' }} />
            <span className="flex items-center text-aoe-gold text-sm">⚜</span>
            <button onClick={handleBet} disabled={placing || !amount || parseInt(amount) < 10}
              className="px-4 py-2 rounded font-cinzel text-[12px] font-bold disabled:opacity-40 transition-opacity"
              style={{ background: 'linear-gradient(135deg, #8b6410, #d4a017)', color: '#07060f' }}>
              {placing ? '…' : 'PARIER'}
            </button>
          </div>
          {amount && parseInt(amount) >= 10 && (() => {
            const a = parseInt(amount);
            const total = Math.floor(a * selected.odds);
            const profit = total - a;
            return (
              <div className="flex justify-between text-[10px] text-aoe-parchment-muted">
                <span>Gain potentiel : <span className="text-emerald-400 font-bold">+{profit} ⚜</span></span>
                <span>Total retour : <span className="text-[#f5c842] font-bold">{total} ⚜</span></span>
              </div>
            );
          })()}
        </div>
      )}
      {msg && (
        <p className={`text-[11px] font-cinzel ${msg.type === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{msg.text}</p>
      )}
    </div>
  );
}

export default function MatchPage() {
  const { t } = useT();
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;
  const initialPlayer = searchParams?.get('player') === '1' ? 1 : searchParams?.get('player') === '2' ? 2 : null;
  const { data: session } = useSession();

  useEffect(() => { window.scrollTo(0, 0); }, []);
  const [match, setMatch] = useState<Match | null>(null);
  const [h2h, setH2h] = useState<{ total: number; player1Wins: number; player2Wins: number } | null>(null);
  const [countdown, setCountdown] = useState('');
  const [loading, setLoading] = useState(true);
  const [betRefreshKey, setBetRefreshKey] = useState(0);

  const refreshMatch = useCallback(async () => {
    if (!id) return;
    try {
      const res = await getMatch(id);
      setMatch(res.data);
    } catch { /* keep existing data */ }
  }, [id]);

  // Initial data fetch
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [matchRes, h2hRes] = await Promise.all([
          getMatch(id),
          getMatchH2H(id).catch(() => null),
        ]);
        setMatch(matchRes.data);
        if (h2hRes) setH2h(h2hRes.data.summary);
      } catch {
        // no mock data — show error
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [id]);

  // Countdown timer
  useEffect(() => {
    if (!match) return;
    const update = () => setCountdown(formatCountdown(match.scheduledAt));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [match]);

  // Polling fallback for LIVE matches — re-fetch every 5s in case socket event is missed
  useEffect(() => {
    if (match?.status !== 'LIVE') return;
    const interval = setInterval(refreshMatch, 5_000);
    return () => clearInterval(interval);
  }, [match?.status, refreshMatch]);

  // Socket: join room + listen for live events
  useEffect(() => {
    if (!match) return;
    const token = session?.user?.accessToken;
    connectSocket(token);
    const s = getSocket();

    const joinRoom = () => s.emit('joinMatchRoom', match.id);
    if (s.connected) joinRoom();
    s.on('connect', joinRoom);

    // BO started: bets locked, civs stored
    s.on('boStarted', (data: { matchId: string; boNumber: number; p1Civ: string; p2Civ: string }) => {
      if (data.matchId !== match.id) return;
      setMatch((prev) => prev ? { ...prev, betsOpen: false, currentBoNumber: data.boNumber, p1Civ: data.p1Civ, p2Civ: data.p2Civ } : prev);
    });

    // BO ended: bets reopen, score updated
    s.on('boEnded', (data: { matchId: string; p1Score: number; p2Score: number; boResult?: BoResult }) => {
      if (data.matchId !== match.id) return;
      setMatch((prev) => {
        if (!prev) return prev;
        const newBoResults = data.boResult
          ? [...(prev.boResults ?? []), data.boResult].sort((a, b) => a.boNumber - b.boNumber)
          : prev.boResults;
        return { ...prev, betsOpen: true, p1Score: data.p1Score, p2Score: data.p2Score, boResults: newBoResults };
      });
    });

    // Generic bets status update
    s.on('betsStatus', (data: { matchId: string; open: boolean }) => {
      if (data.matchId !== match.id) return;
      setMatch((prev) => prev ? { ...prev, betsOpen: data.open } : prev);
    });

    // Match result (winner decided)
    s.on('matchResult', (data: { matchId: string; winnerId: string; p1Score: number; p2Score: number }) => {
      if (data.matchId !== match.id) return;
      refreshMatch();
    });

    // Odds updated by volume
    s.on('oddsUpdate', (data: { matchId: string; odds1: number; odds2: number }) => {
      if (data.matchId !== match.id) return;
      setMatch((prev) => prev ? { ...prev, odds1: data.odds1, odds2: data.odds2 } : prev);
    });

    return () => {
      s.off('connect', joinRoom);
      s.off('boStarted');
      s.off('boEnded');
      s.off('betsStatus');
      s.off('matchResult');
      s.off('oddsUpdate');
      s.emit('leaveMatchRoom', match.id);
    };
  }, [match?.id, session, refreshMatch]);

  if (loading) {
    return (
      <div className="min-h-screen bg-aoe flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-aoe-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!match) {
    return (
      <div className="min-h-screen bg-aoe flex items-center justify-center">
        <div className="text-center">
          <p className="text-aoe-parchment font-cinzel text-xl">{t('common_error')}</p>
          <Link href="/" className="text-aoe-gold hover:underline mt-3 block">{t('common_back')}</Link>
        </div>
      </div>
    );
  }

  const isLive = match.status === 'LIVE';
  const betsLocked = match.betsOpen === false && isLive;
  const gameOngoing = betsLocked;
  const twitchChannel = match.twitchChannel ?? match.tournament?.twitchChannel ?? null;
  const hasBoHistory = (match.boResults?.length ?? 0) > 0;

  return (
    <div className="min-h-screen bg-aoe">
      {/* ── Header ── */}
      <div className="bg-aoe-bg-card border-b border-aoe-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <Link href="/" className="inline-flex items-center gap-2 text-aoe-parchment-dim hover:text-aoe-parchment transition-colors text-sm mb-4">
            <ArrowLeft size={16} />
            {t('common_back')}
          </Link>

          {/* Tournament info row */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {match.tournament && (
              <span className={getTierBadgeClass(match.tournament.tier)}>
                {match.tournament.tier}
              </span>
            )}
            {match.tournament?.name && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-cinzel font-bold tracking-wide"
                style={{ background: 'linear-gradient(135deg, rgba(212,160,23,0.15), rgba(212,160,23,0.08))', border: '1px solid rgba(212,160,23,0.4)', color: '#f5c842' }}>
                🏆 {match.tournament.name}
              </span>
            )}
            <span className="text-aoe-parchment-muted text-xs border border-aoe-border rounded px-1.5 py-0.5 font-cinzel">
              {match.format}
            </span>

            {/* Twitch button */}
            {twitchChannel && (
              <a
                href={`https://twitch.tv/${twitchChannel}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1 rounded text-sm font-cinzel text-purple-300 hover:text-purple-200 transition-colors"
                style={{ background: 'rgba(145,70,255,0.15)', border: '1px solid rgba(145,70,255,0.35)' }}
              >
                <Tv size={13} />
                Twitch
              </a>
            )}

            {/* Bets locked banner */}
            {betsLocked && (
              <div className="flex items-center gap-1.5 px-3 py-1 rounded text-sm font-cinzel text-red-400"
                style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)' }}>
                <Lock size={13} />
                {t('matches_bets_closed')} — BO {match.currentBoNumber}
              </div>
            )}
          </div>

          {/* Status */}
          <div className="mb-4">
            {isLive ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded bg-red-900/20 border border-red-800/50">
                <div className="live-dot" />
                <span className="text-xs text-red-400 font-cinzel font-bold">{t('match_live')}</span>
              </div>
            ) : match.status === 'UPCOMING' ? (
              <div className="flex items-center gap-1.5 text-aoe-parchment-dim text-sm">
                <Calendar size={14} />
                <span>{formatDateTime(match.scheduledAt)}</span>
                <span className="text-aoe-gold font-cinzel font-bold ml-1">({countdown})</span>
              </div>
            ) : match.status === 'COMPLETED' ? (
              <div className="flex items-center gap-1.5">
                <span className="aoe-badge-completed">{t('matches_finished')}</span>
                {match.resultScore && (
                  <span className="text-aoe-gold font-cinzel font-bold text-lg ml-2">{match.resultScore}</span>
                )}
              </div>
            ) : null}
          </div>

          {/* Players VS row */}
          <div className="flex items-center justify-between flex-wrap gap-4">
            {/* Player 1 */}
            <div className="flex items-center gap-4">
              <PlayerAvatar name={match.player1.name} playerId={match.player1.id} avatarUrl={match.player1.avatarUrl} size={64} />
              <div>
                <h1 className="font-cinzel font-black text-xl sm:text-3xl text-aoe-parchment">{match.player1.name}</h1>
                {gameOngoing && match.p1Civ && (
                  <p className="text-amber-400 text-xs font-cinzel mt-0.5">{formatCiv(match.p1Civ)}</p>
                )}
              </div>
            </div>

            {/* Center — score or VS */}
            <div className="text-center">
              {isLive ? (
                <div className="flex items-center gap-3">
                  <span className="font-cinzel font-black text-5xl text-amber-400">{match.p1Score ?? 0}</span>
                  <span className="font-cinzel text-aoe-parchment-muted text-xl">-</span>
                  <span className="font-cinzel font-black text-5xl text-blue-400">{match.p2Score ?? 0}</span>
                </div>
              ) : null}
              {isLive && (
                <div className="flex items-center justify-center gap-1 mt-1">
                  <Zap size={12} className="text-aoe-gold animate-pulse" />
                  <span className="text-xs text-aoe-parchment-dim font-cinzel">{t('match_in_progress')}</span>
                </div>
              )}
            </div>

            {/* Player 2 */}
            <div className="flex items-center gap-4 flex-row-reverse">
              <PlayerAvatar name={match.player2.name} playerId={match.player2.id} avatarUrl={match.player2.avatarUrl} size={64} />
              <div className="text-right">
                <h1 className="font-cinzel font-black text-3xl text-aoe-parchment">{match.player2.name}</h1>
                {gameOngoing && match.p2Civ && (
                  <p className="text-blue-400 text-xs font-cinzel mt-0.5">{formatCiv(match.p2Civ)}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left column */}
          <div className="lg:col-span-2 space-y-5">
            <PlayerStats
              player1={match.player1}
              player2={match.player2}
              recentForm1={match.recentForm?.player1}
              recentForm2={match.recentForm?.player2}
              h2h={h2h ?? undefined}
              p1Score={match.p1Score}
              p2Score={match.p2Score}
              matchStatus={match.status}
              winnerId={match.winnerId}
            />

            {/* BO history */}
            {hasBoHistory && (
              <div className="aoe-card p-4 space-y-2">
                <div className="flex items-center gap-2 mb-3">
                  <Swords size={14} className="text-aoe-gold" />
                  <h3 className="font-cinzel font-bold text-sm text-aoe-gold tracking-wider uppercase">
                    BO History
                  </h3>
                  {isLive && (
                    <span className="ml-auto text-[10px] text-aoe-parchment-muted font-cinzel">
                      {match.p1Score ?? 0} — {match.p2Score ?? 0}
                    </span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {match.boResults!.map((bo) => (
                    <BoHistoryCard
                      key={bo.boNumber}
                      bo={bo}
                      p1Name={match.player1.name}
                      p2Name={match.player2.name}
                      p1Id={match.player1Id}
                    />
                  ))}
                </div>
              </div>
            )}

            {twitchChannel ? (
              <div className="rounded-xl overflow-hidden" style={{ border: '1px solid #1e1a30' }}>
                <div className="flex items-center gap-2 px-4 py-2.5" style={{ background: '#0d0b1a', borderBottom: '1px solid #1e1a30' }}>
                  <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                  <span className="text-[12px] font-bold uppercase tracking-widest" style={{ color: '#9146ff' }}>{t('matches_filter_live')} — Twitch</span>
                  <span className="text-[11px] ml-auto" style={{ color: '#6b6488' }}>{twitchChannel}</span>
                </div>
                <div style={{ aspectRatio: '16/9', background: '#000' }}>
                  <iframe
                    src={`https://player.twitch.tv/?channel=${twitchChannel}&parent=${typeof window !== 'undefined' ? window.location.hostname : 'localhost'}&autoplay=false&muted=true`}
                    allowFullScreen
                    style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                  />
                </div>
              </div>
            ) : (
              <div className="rounded-xl flex flex-col items-center justify-center py-10 gap-3" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#6b6488"><path d="M2.149 0L.537 4.119v16.836h5.731V24h3.224l3.045-3.045h4.657l6.269-6.269V0H2.149zm19.164 13.612l-3.582 3.582H13l-3.045 3.045v-3.045H4.537V2.149h16.776v11.463zm-3.582-7.343v6.262h-2.149V6.269h2.149zm-5.731 0v6.262H9.851V6.269H12z"/></svg>
                <p className="text-[12px]" style={{ color: '#6b6488' }}>No Twitch stream configured</p>
              </div>
            )}
            <MatchChat matchId={match.id} />
          </div>

          {/* Right column */}
          <div className="space-y-4">
            <BetForm match={match} onBetPlaced={() => { refreshMatch(); setBetRefreshKey(k => k + 1); }} initialPlayer={initialPlayer} />
            {match.status === 'UPCOMING' && match.betsOpen && match.format !== 'BO1' && (
              <ExactScoreBets match={match} onBetPlaced={() => { refreshMatch(); setBetRefreshKey(k => k + 1); }} />
            )}
            <MyMatchBets matchId={match.id} match={match} refreshKey={betRefreshKey} />

            {/* Match info */}
            <div className="aoe-card p-4 space-y-2 text-xs">
              <h4 className="font-cinzel text-aoe-gold text-xs uppercase tracking-wider mb-2">Info</h4>
              <div className="flex justify-between">
                <span className="text-aoe-parchment-muted">Format</span>
                <span className="text-aoe-parchment font-cinzel">{match.format}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-aoe-parchment-muted">Date</span>
                <span className="text-aoe-parchment">{formatDateTime(match.scheduledAt)}</span>
              </div>
              {match.tournament?.prizePool && (
                <div className="flex justify-between">
                  <span className="text-aoe-parchment-muted">{t('tourn_prize')}</span>
                  <span className="text-aoe-gold font-semibold">{match.tournament.prizePool}</span>
                </div>
              )}
              {match.betVolume && match.betVolume.total > 0 && (
                <div className="flex justify-between">
                  <span className="text-aoe-parchment-muted">{t('lb_wagered')}</span>
                  <span className="text-aoe-gold">
                    {new Intl.NumberFormat('fr-FR').format(match.betVolume.total)} ⚜
                  </span>
                </div>
              )}
              {isLive && (
                <div className="flex justify-between items-center">
                  <span className="text-aoe-parchment-muted">{t('nav_matches')}</span>
                  {betsLocked ? (
                    <span className="flex items-center gap-1 text-red-400">
                      <Lock size={10} />{t('bet_closed')}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-emerald-400">
                      <Shield size={10} />{t('matches_filter_live')}
                    </span>
                  )}
                </div>
              )}
              {twitchChannel && (
                <div className="pt-2">
                  <a
                    href={`https://twitch.tv/${twitchChannel}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-2 rounded font-cinzel text-xs text-purple-300 hover:text-purple-200 transition-colors"
                    style={{ background: 'rgba(145,70,255,0.12)', border: '1px solid rgba(145,70,255,0.3)' }}
                  >
                    <Tv size={12} />
                    Twitch : {twitchChannel}
                  </a>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
