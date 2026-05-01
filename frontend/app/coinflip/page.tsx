'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { signInWithSteam } from '@/lib/authHelpers';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { apiClient, setAuthToken } from '@/lib/api';
import { Coins, Plus, Users, Trophy, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CoinFlipModal } from '@/components/coinflip/CoinFlipModal';
import type { CoinSide } from '@/components/coinflip/CoinFlipAnimation';

interface CoinFlipGame {
  id: string;
  status: 'WAITING' | 'FLIPPING' | 'COMPLETED';
  amount: number;
  side: CoinSide;
  result?: CoinSide;
  winnerId?: string;
  creator: {
    id: string;
    username: string;
    avatar: string | null;
  };
  joiner?: {
    id: string;
    username: string;
    avatar: string | null;
  };
  createdAt: string;
}

const GLOBAL_CSS = `
@keyframes cf-pulse-gold { 0%,100%{box-shadow:0 0 8px rgba(255,197,66,0.3)} 50%{box-shadow:0 0 24px rgba(255,197,66,0.5),0 0 48px rgba(255,197,66,0.2)} }
@keyframes cf-slide-in { 0%{opacity:0;transform:translateY(12px)} 100%{opacity:1;transform:translateY(0)} }
@keyframes cf-result-in { 0%{opacity:0;transform:scale(0.85)} 100%{opacity:1;transform:scale(1)} }
.cf-gold-pulse { animation: cf-pulse-gold 2s ease-in-out infinite; }
.cf-slide-in { animation: cf-slide-in 0.35s ease-out both; }
.cf-result-in { animation: cf-result-in 0.3s ease-out both; }
`;

const CANCEL_DELAY_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Mini version of the flip coin — statique, utilisée dans la liste "flips
 * ouverts" à la place du badge texte "🏹 Archers" / "⚔ Swords". Même
 * gradient / shine que CoinFlipAnimation pour rester cohérent visuellement.
 * VS16 sur l'arc (U+FE0F) pour forcer la présentation color-emoji sur
 * Windows + Segoe UI Emoji (même correctif que CoinFlipAnimation).
 */
function MiniCoin({ side, size = 22 }: { side: CoinSide; size?: number }) {
  const isArchers = side === 'crown';
  return (
    <span
      className="inline-flex rounded-full items-center justify-center shrink-0 align-middle relative overflow-hidden"
      style={{
        width: size,
        height: size,
        background: isArchers
          ? 'radial-gradient(ellipse at 35% 30%, #ffd97a 0%, #ffc542 40%, #b8860b 80%, #8b6914 100%)'
          : 'radial-gradient(ellipse at 35% 30%, #c0c0c0 0%, #8a8a9a 40%, #6a6a7a 80%, #4a4a5a 100%)',
        boxShadow: isArchers
          ? 'inset 0 -1px 2px rgba(0,0,0,0.4), 0 0 8px rgba(255,197,66,0.35)'
          : 'inset 0 -1px 2px rgba(0,0,0,0.4), 0 0 6px rgba(138,138,154,0.25)',
        border: `1px solid ${isArchers ? '#c4960f' : '#7a7a8a'}`,
      }}
    >
      <span
        className="absolute inset-0 rounded-full pointer-events-none"
        style={{
          background: 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 55%, rgba(0,0,0,0.08) 100%)',
        }}
      />
      <span
        className="select-none relative"
        style={{
          fontSize: size * 0.58,
          color: isArchers ? '#4a3804' : '#2a2a3a',
          filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.35))',
          lineHeight: 1,
          fontFamily: '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Twemoji Mozilla",sans-serif',
        }}
      >
        {isArchers ? '\u{1F3F9}\uFE0F' : '⚔️'}
      </span>
    </span>
  );
}

function CancelOrWait({ gameId, createdAt, onCancel }: { gameId: string; createdAt: string; onCancel: (id: string) => void }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const created = new Date(createdAt).getTime();
  const canCancelAt = created + CANCEL_DELAY_MS;
  const remaining = canCancelAt - now;

  if (remaining <= 0) {
    return (
      <button
        onClick={() => onCancel(gameId)}
        className="w-full py-2 rounded-lg text-[12px] font-bold uppercase tracking-wider transition-all hover:opacity-80"
        style={{
          background: 'rgba(248,113,113,0.1)',
          color: '#f87171',
          border: '1px solid rgba(248,113,113,0.2)',
        }}
      >
        Cancel
      </button>
    );
  }

  const min = Math.floor(remaining / 60000);
  const sec = Math.floor((remaining % 60000) / 1000);

  return (
    <div className="w-full py-2 rounded-lg text-[11px] text-center" style={{ color: '#4a4468' }}>
      <Clock size={10} className="inline mr-1 -mt-px" />
      You can cancel in {min}:{sec.toString().padStart(2, '0')}
    </div>
  );
}

export default function CoinFlipPage() {
  const { data: session } = useSession();
  const { t } = useT();

  const [games, setGames] = useState<CoinFlipGame[]>([]);
  // Recent completed flips are now derived from the live `games` list rather
  // than a separate endpoint — backend's /coinflip returns up to 10 most
  // recent COMPLETED within 30min alongside WAITING/FLIPPING.
  const [betAmount, setBetAmount] = useState('5');
  const [selectedSide, setSelectedSide] = useState<CoinSide>('crown');
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [creating, setCreating] = useState(false);

  // Modal state
  const [activeGame, setActiveGame] = useState<CoinFlipGame | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const userCoins = (session?.user as { coins?: number })?.coins ?? 0;
  const userId = (session?.user as { id?: string })?.id;

  useEffect(() => {
    if (session?.user?.accessToken) setAuthToken(session.user.accessToken);
  }, [session]);

  useEffect(() => {
    if (document.getElementById('cf-css')) return;
    const s = document.createElement('style');
    s.id = 'cf-css';
    s.textContent = GLOBAL_CSS;
    document.head.appendChild(s);
  }, []);

  const fetchGames = useCallback(async () => {
    try {
      const active = await apiClient.get('/coinflip');
      // Active endpoint now returns WAITING/FLIPPING + up to 10 most recent
      // COMPLETED (within 30min). Completed ones drive the "recent results"
      // strip below; older completed flips only show in the Historique tab.
      setGames(active.data.data ?? []);
    } catch {
      // silent
    }
  }, []);

  const [viewTab, setViewTab] = useState<'live' | 'history'>('live');
  const [historyGames, setHistoryGames] = useState<CoinFlipGame[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await apiClient.get('/coinflip/history/all?limit=50');
      setHistoryGames(res.data.data ?? []);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (viewTab === 'history') fetchHistory();
  }, [viewTab, fetchHistory]);

  useEffect(() => {
    fetchGames();
  }, [fetchGames]);

  // Socket connection for real-time updates
  useEffect(() => {
    const { connectSocket, getSocket } = require('@/lib/socket');
    connectSocket();
    const s = getSocket();

    s.on('coinflip:created', (data: CoinFlipGame) => {
      setGames((prev) => [data, ...prev]);
    });

    s.on('coinflip:joined', (data: CoinFlipGame) => {
      setGames((prev) => prev.map((g) => (g.id === data.id ? data : g)));
      // If this is our game, open the modal
      if (data.creator.id === userId || data.joiner?.id === userId) {
        setActiveGame(data);
        setModalOpen(true);
      }
    });

    s.on('coinflip:result', (data: CoinFlipGame) => {
      // Replace the WAITING/FLIPPING version with the completed one. The
      // active endpoint already caps to 10 recent completed in 30min, so on
      // a refresh older ones naturally fall into history.
      setGames((prev) => {
        const filtered = prev.filter((g) => g.id !== data.id);
        const completed = [data, ...filtered.filter(g => g.status === 'COMPLETED')].slice(0, 10);
        const open = filtered.filter(g => g.status !== 'COMPLETED');
        return [...open, ...completed];
      });
      setActiveGame((prev) => (prev?.id === data.id ? data : prev));
    });

    s.on('coinflip:cancelled', (data: { id: string }) => {
      setGames((prev) => prev.filter((g) => g.id !== data.id));
    });

    return () => {
      s.off('coinflip:created');
      s.off('coinflip:joined');
      s.off('coinflip:result');
      s.off('coinflip:cancelled');
    };
  }, [fetchGames, userId]);

  async function handleCreate() {
    if (!session) {
      // Redirige directement vers Steam OpenID plutôt que d'afficher
      // "Connexion requise" — l'utilisateur peut lancer son flip sans friction.
      signInWithSteam();
      return;
    }
    const amount = parseInt(betAmount);
    if (!amount || amount < 2) {
      showMsg('error', 'Minimum 2 ⚜');
      return;
    }
    if (amount > 500) {
      showMsg('error', 'Maximum 500 ⚜');
      return;
    }
    if (amount > userCoins) {
      showMsg('error', t('bet_err_balance'));
      return;
    }

    setCreating(true);
    try {
      const res = await apiClient.post('/coinflip/create', {
        amount,
        side: selectedSide,
      });
      const game = res.data.data as CoinFlipGame;
      setGames((prev) => [game, ...prev]);
      setBetAmount('5');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showMsg('error', err?.response?.data?.error ?? err?.message ?? t('common_error'));
    } finally {
      setCreating(false);
    }
  }

  async function handleJoin(game: CoinFlipGame) {
    if (!session) {
      // Même logique que handleCreate — pas de message d'erreur, on saute
      // direct sur l'OpenID Steam pour réduire la friction.
      signInWithSteam();
      return;
    }
    if (game.creator.id === userId) {
      showMsg('error', t('coinflip_cant_join_own'));
      return;
    }
    try {
      const res = await apiClient.post(`/coinflip/${game.id}/join`);
      const updated = res.data.data as CoinFlipGame;
      setActiveGame(updated);
      setModalOpen(true);
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      showMsg('error', err?.response?.data?.error ?? err?.message ?? t('common_error'));
    }
  }

  async function handleCancel(gameId: string) {
    try {
      await apiClient.post(`/coinflip/${gameId}/cancel`);
      setGames((prev) => prev.filter((g) => g.id !== gameId));
    } catch {
      // silent — the timer already tells the user when they can cancel
    }
  }

  function showMsg(type: 'success' | 'error', text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  }

  const waitingGames = games.filter((g) => g.status === 'WAITING');
  const recentResults = games.filter((g) => g.status === 'COMPLETED').slice(0, 10);
  const isHighValue = (amount: number) => amount >= 100;

  // Build modal players
  const modalPlayer1 = activeGame
    ? {
        id: activeGame.creator.id,
        username: activeGame.creator.username,
        avatar: activeGame.creator.avatar,
        side: activeGame.side,
      }
    : null;
  const modalPlayer2 =
    activeGame?.joiner
      ? {
          id: activeGame.joiner.id,
          username: activeGame.joiner.username,
          avatar: activeGame.joiner.avatar,
          side: activeGame.side === 'crown' ? ('shield' as CoinSide) : ('crown' as CoinSide),
        }
      : null;

  return (
    <div className="min-h-screen relative" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="flex items-center justify-center gap-3 mb-1">
            <Coins size={28} style={{ color: '#ffd97a' }} />
            <h1
              className="text-3xl font-bold"
              style={{ fontFamily: 'Cinzel, serif', color: '#ffd97a' }}
            >
              COINFLIP
            </h1>
          </div>
          <p className="text-[11px] tracking-widest uppercase" style={{ color: '#6b6488' }}>
            {t('coinflip_subtitle')}
          </p>
          {/* Tab switcher : En direct / Historique */}
          <div className="flex items-center justify-center gap-1 mt-4">
            <button
              onClick={() => setViewTab('live')}
              className="px-4 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-all"
              style={{
                background: viewTab === 'live' ? 'rgba(255,197,66,0.15)' : 'transparent',
                color: viewTab === 'live' ? '#ffd97a' : '#6b6488',
                border: viewTab === 'live' ? '1px solid rgba(255,197,66,0.3)' : '1px solid transparent',
              }}
            >
              <Users size={12} className="inline mr-1.5" />
              En direct · {waitingGames.length + recentResults.length}
            </button>
            <button
              onClick={() => setViewTab('history')}
              className="px-4 py-1.5 rounded-lg text-[11px] font-bold tracking-wider uppercase transition-all"
              style={{
                background: viewTab === 'history' ? 'rgba(255,197,66,0.15)' : 'transparent',
                color: viewTab === 'history' ? '#ffd97a' : '#6b6488',
                border: viewTab === 'history' ? '1px solid rgba(255,197,66,0.3)' : '1px solid transparent',
              }}
            >
              <Trophy size={12} className="inline mr-1.5" />
              Historique
            </button>
          </div>
        </div>

        {/* Message */}
        {msg && (
          <div
            className={cn(
              'p-2.5 rounded-lg mb-4 text-[12px]',
              msg.type === 'success'
                ? 'bg-emerald-950 border border-emerald-800/40 text-emerald-400'
                : 'bg-red-950 border border-red-800/40 text-red-400'
            )}
          >
            {msg.text}
          </div>
        )}

        {/* Historique tab — full completed flips list */}
        {viewTab === 'history' && (
          <div className="rounded-2xl p-5" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
            <div className="flex items-center gap-2 mb-4">
              <Trophy size={16} style={{ color: '#6b6488' }} />
              <h2 className="text-[14px] font-bold tracking-wider uppercase" style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}>
                Historique des coinflips
              </h2>
              <span className="ml-auto text-[11px]" style={{ color: '#6b6488' }}>{historyGames.length} flips</span>
            </div>
            {historyLoading ? (
              <div className="text-center py-8 text-[12px]" style={{ color: '#6b6488' }}>Chargement…</div>
            ) : historyGames.length === 0 ? (
              <div className="text-center py-8 text-[12px]" style={{ color: '#6b6488' }}>Aucun flip terminé.</div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {historyGames.map((game) => {
                  const isCreatorWin = game.result === game.side;
                  const winnerName = isCreatorWin ? game.creator.username : (game.joiner?.username ?? '?');
                  const loserName  = isCreatorWin ? (game.joiner?.username ?? '?') : game.creator.username;
                  const winAmount  = game.amount * 2;
                  const isCrown = game.result === 'crown';
                  return (
                    <div
                      key={game.id}
                      className="flex items-center gap-3 px-3 py-3 rounded-lg text-[13px]"
                      style={{
                        background: 'linear-gradient(90deg, rgba(255,197,66,0.05) 0%, rgba(10,8,23,1) 45%)',
                        border: '1px solid #1e1a30',
                      }}
                    >
                      {/* Mini coin with the winning side facing up */}
                      <div
                        className="shrink-0 flex items-center justify-center rounded-full relative"
                        style={{
                          width: 44, height: 44,
                          background: isCrown
                            ? 'radial-gradient(ellipse at 35% 30%, #ffd97a 0%, #ffc542 45%, #b8860b 85%, #8b6914 100%)'
                            : 'radial-gradient(ellipse at 35% 30%, #c0c0c0 0%, #8a8a9a 45%, #6a6a7a 85%, #4a4a5a 100%)',
                          boxShadow: isCrown
                            ? 'inset 0 -2px 5px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,230,120,0.35), 0 0 12px rgba(255,197,66,0.4)'
                            : 'inset 0 -2px 5px rgba(0,0,0,0.4), inset 0 2px 4px rgba(200,200,220,0.3), 0 0 10px rgba(138,138,154,0.3)',
                          border: `1.5px solid ${isCrown ? '#c4960f' : '#7a7a8a'}`,
                        }}
                      >
                        <span style={{
                          fontSize: 20,
                          color: isCrown ? '#8b6914' : '#4a4a5a',
                          filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.4))',
                          lineHeight: 1,
                        }}>
                          {isCrown ? '🏹' : '⚔️'}
                        </span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-[14px]">👑</span>
                          <span className="font-bold truncate" style={{ color: '#ffd97a', textShadow: '0 0 6px rgba(255,197,66,0.35)' }}>
                            {winnerName}
                          </span>
                          <span className="font-bold shrink-0" style={{ color: '#4ade80' }}>
                            +{winAmount.toLocaleString('fr-FR')} ⚜
                          </span>
                        </div>
                        <div className="text-[11px] truncate mt-0.5" style={{ color: '#6b6488' }}>
                          vs <span style={{ color: '#8a8299' }}>{loserName}</span>
                          <span className="mx-1.5" style={{ color: '#3a3560' }}>·</span>
                          mise {game.amount.toLocaleString('fr-FR')} ⚜
                          <span className="mx-1.5" style={{ color: '#3a3560' }}>·</span>
                          {new Date(game.createdAt).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>

                      <button
                        onClick={() => {
                          setActiveGame(game);
                          setModalOpen(true);
                        }}
                        className="shrink-0 px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-all hover:brightness-110"
                        style={{
                          background: 'rgba(255,197,66,0.1)',
                          color: '#ffd97a',
                          border: '1px solid rgba(255,197,66,0.3)',
                        }}
                      >
                        Rejouer
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Create a flip card */}
        {viewTab === 'live' && (<>
        <div
          className="rounded-2xl p-5 mb-6"
          style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
        >
          <div className="flex items-center gap-2 mb-4">
            <Plus size={16} style={{ color: '#ffd97a' }} />
            <h2
              className="text-[14px] font-bold tracking-wider uppercase"
              style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
            >
              {t('coinflip_create_title')}
            </h2>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
            {/* Side selector */}
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedSide('crown')}
                className={cn(
                  'flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl transition-all',
                  selectedSide === 'crown'
                    ? 'cf-gold-pulse'
                    : 'hover:bg-[#13111f]'
                )}
                style={{
                  background:
                    selectedSide === 'crown'
                      ? 'rgba(255,197,66,0.12)'
                      : '#0d0b1a',
                  border: `1.5px solid ${
                    selectedSide === 'crown' ? '#ffc542' : '#1e1a30'
                  }`,
                }}
              >
                <span style={{ fontSize: 28 }}>🏹</span>
                <span
                  className="text-[11px] font-bold uppercase"
                  style={{
                    color: selectedSide === 'crown' ? '#ffd97a' : '#6b6488',
                  }}
                >
                  Archers
                </span>
              </button>
              <button
                onClick={() => setSelectedSide('shield')}
                className={cn(
                  'flex flex-col items-center gap-1.5 px-5 py-3 rounded-xl transition-all',
                  selectedSide === 'shield'
                    ? ''
                    : 'hover:bg-[#13111f]'
                )}
                style={{
                  background:
                    selectedSide === 'shield'
                      ? 'rgba(138,138,154,0.1)'
                      : '#0d0b1a',
                  border: `1.5px solid ${
                    selectedSide === 'shield' ? '#8a8a9a' : '#1e1a30'
                  }`,
                  boxShadow:
                    selectedSide === 'shield'
                      ? '0 0 12px rgba(138,138,154,0.2)'
                      : 'none',
                }}
              >
                <span style={{ fontSize: 28 }}>⚔️</span>
                <span
                  className="text-[11px] font-bold uppercase"
                  style={{
                    color: selectedSide === 'shield' ? '#c0c0c0' : '#6b6488',
                  }}
                >
                  Swords
                </span>
              </button>
            </div>

            {/* Amount input + quick buttons */}
            <div className="flex-1 flex flex-col gap-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type="number"
                    value={betAmount}
                    onChange={(e) => setBetAmount(e.target.value)}
                    placeholder={t('deposit_amount_coins')}
                    className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    style={{
                      background: '#13111f',
                      border: '1px solid #1e1a30',
                      color: '#e8e2f5',
                    }}
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[#ffd97a] text-[11px]">
                    ⚜
                  </span>
                </div>
                {[1, 10, 50, 100].map((v) => (
                  <button
                    key={v}
                    onClick={() =>
                      setBetAmount((a) => String((parseInt(a) || 0) + v))
                    }
                    className="px-3 py-2 rounded-lg text-[11px] font-bold hover:opacity-80"
                    style={{
                      background: '#1e1a30',
                      color: '#9990b8',
                      border: '1px solid #2a2640',
                    }}
                  >
                    +{v}
                  </button>
                ))}
                <button
                  onClick={() => setBetAmount(String(userCoins))}
                  className="px-3 py-2 rounded-lg text-[11px] font-bold hover:opacity-80"
                  style={{
                    background: '#1e1a30',
                    color: '#9990b8',
                    border: '1px solid #2a2640',
                  }}
                >
                  MAX
                </button>
              </div>
              <Button
                onClick={handleCreate}
                disabled={creating || !betAmount || parseInt(betAmount) < 1}
                className="w-full py-3 rounded-lg text-[14px] font-bold tracking-wider transition-all disabled:opacity-40"
                style={{ background: '#ffc542', color: '#07060f', border: 'none' }}
              >
                {creating
                  ? t('common_processing')
                  : `${t('coinflip_create_btn')} ${
                      betAmount
                        ? parseInt(betAmount).toLocaleString('fr-FR')
                        : '...'
                    } ⚜`}
              </Button>
            </div>
          </div>
        </div>

        {/* Open Flips Lobby */}
        <div
          className="rounded-2xl p-5 mb-6"
          style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
        >
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users size={16} style={{ color: '#ffd97a' }} />
              <h2
                className="text-[14px] font-bold tracking-wider uppercase"
                style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
              >
                {t('coinflip_lobby_title')}
              </h2>
            </div>
            <Badge
              variant="outline"
              className="text-[10px]"
              style={{ color: '#6b6488', borderColor: '#1e1a30' }}
            >
              {waitingGames.length} {t('coinflip_open')}
            </Badge>
          </div>

          {waitingGames.length === 0 ? (
            <div
              className="text-center py-12 rounded-xl"
              style={{ background: '#0a0817', border: '1px dashed #1e1a30' }}
            >
              <Coins
                size={40}
                className="mx-auto mb-3"
                style={{ color: '#2a2640' }}
              />
              <p className="text-[13px]" style={{ color: '#3d3860' }}>
                {t('coinflip_empty')}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {waitingGames.map((game, idx) => (
                <div
                  key={game.id}
                  className={cn(
                    'cf-slide-in rounded-xl p-4 flex flex-col gap-3 transition-all hover:translate-y-[-2px]',
                    isHighValue(game.amount) && 'cf-gold-pulse'
                  )}
                  style={{
                    background: '#0a0817',
                    border: `1px solid ${
                      isHighValue(game.amount) ? '#ffc54240' : '#1e1a30'
                    }`,
                    animationDelay: `${idx * 0.05}s`,
                  }}
                >
                  {/* Creator info */}
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-full overflow-hidden shrink-0"
                      style={{ border: '2px solid #1e1a30' }}
                    >
                      {game.creator.avatar ? (
                        <img
                          src={game.creator.avatar}
                          alt={game.creator.username}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div
                          className="w-full h-full flex items-center justify-center text-[11px] font-bold"
                          style={{ background: '#1e1a30', color: '#6b6488' }}
                        >
                          {game.creator.username[0]?.toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p
                        className="text-[12px] font-medium truncate"
                        style={{ color: '#e8e2f5' }}
                      >
                        {game.creator.username}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <MiniCoin side={game.side} size={20} />
                        <span
                          className="text-[10px] uppercase tracking-wider"
                          style={{
                            color: game.side === 'crown' ? '#ffd97a' : '#c0c0c0',
                          }}
                        >
                          {game.side === 'crown' ? 'Archers' : 'Swords'}
                        </span>
                      </div>
                    </div>
                    {/* Amount — fleur-de-lys in gold next to the number */}
                    <div className="text-right shrink-0 flex items-center gap-1.5">
                      <p
                        className="text-[18px] font-bold tabular-nums"
                        style={{
                          color: isHighValue(game.amount) ? '#ffd97a' : '#e8e2f5',
                          fontFamily: 'Cinzel, serif',
                        }}
                      >
                        {game.amount.toLocaleString('fr-FR')}
                      </p>
                      <span
                        className="text-[18px] leading-none"
                        style={{
                          color: '#ffc542',
                          filter: 'drop-shadow(0 0 8px rgba(255,197,66,0.55))',
                        }}
                      >
                        ⚜
                      </span>
                    </div>
                  </div>

                  {/* Join or Cancel button */}
                  {game.creator.id === userId ? (
                    <CancelOrWait gameId={game.id} createdAt={game.createdAt} onCancel={handleCancel} />
                  ) : (
                    <button
                      onClick={() => handleJoin(game)}
                      className="w-full py-2 rounded-lg text-[12px] font-bold uppercase tracking-wider transition-all hover:opacity-80 flex items-center justify-center gap-2"
                      style={{
                        background:
                          game.side === 'crown'
                            ? 'rgba(138,138,154,0.15)'
                            : 'rgba(255,197,66,0.15)',
                        color: game.side === 'crown' ? '#c0c0c0' : '#ffd97a',
                        border: `1px solid ${
                          game.side === 'crown' ? '#8a8a9a40' : '#ffc54240'
                        }`,
                      }}
                    >
                      <MiniCoin side={game.side === 'crown' ? 'shield' : 'crown'} size={20} />
                      <span>
                        {t('coinflip_join')}{' '}
                        {game.side === 'crown' ? 'Swords' : 'Archers'}
                      </span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Results */}
        {recentResults.length > 0 && (
          <div
            className="rounded-2xl p-5"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Clock size={16} style={{ color: '#6b6488' }} />
              <h2
                className="text-[14px] font-bold tracking-wider uppercase"
                style={{ fontFamily: 'Cinzel, serif', color: '#e8e2f5' }}
              >
                {t('coinflip_recent')}
              </h2>
            </div>
            <ScrollArea className="w-full">
              <div className="flex gap-2 pb-2">
                {recentResults.slice(0, 10).map((game, idx) => {
                  const isCreatorWin = game.result === game.side;
                  const winnerName = isCreatorWin
                    ? game.creator.username
                    : game.joiner?.username ?? '?';
                  return (
                    <div
                      key={game.id}
                      className="cf-result-in shrink-0 rounded-xl p-3 flex flex-col items-center gap-1.5"
                      style={{
                        background: '#0a0817',
                        border: '1px solid #1e1a30',
                        minWidth: 120,
                        animationDelay: `${idx * 0.05}s`,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 20,
                          filter: `drop-shadow(0 0 6px ${
                            game.result === 'crown'
                              ? 'rgba(245,200,66,0.4)'
                              : 'rgba(192,192,192,0.3)'
                          })`,
                        }}
                      >
                        {game.result === 'crown' ? '🏹' : '⚔️'}
                      </span>
                      <p
                        className="text-[12px] font-bold"
                        style={{
                          color:
                            game.result === 'crown' ? '#ffd97a' : '#c0c0c0',
                        }}
                      >
                        {game.amount.toLocaleString('fr-FR')} ⚜
                      </p>
                      <p
                        className="text-[10px] truncate max-w-[100px]"
                        style={{ color: '#6b6488' }}
                      >
                        {winnerName}
                      </p>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}
        </>)}
      </div>

      {/* CoinFlip Modal */}
      {activeGame && modalPlayer1 && modalPlayer2 && (
        <CoinFlipModal
          isOpen={modalOpen}
          onClose={() => {
            setModalOpen(false);
            setActiveGame(null);
          }}
          onPlayAgain={() => {
            setModalOpen(false);
            setActiveGame(null);
          }}
          player1={modalPlayer1}
          player2={modalPlayer2}
          betAmount={activeGame.amount}
          result={activeGame.result}
          winnerId={activeGame.winnerId}
          currentUserId={userId}
        />
      )}
    </div>
  );
}
