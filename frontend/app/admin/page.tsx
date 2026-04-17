'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback, useDeferredValue, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Match, User } from '@/types';
import { setAuthToken, apiClient } from '@/lib/api';
import {
  getFlaggedMatches, getAdminUsers, banUser, setMatchResult,
  getScraperLogs, triggerScraper, cancelMatch, deleteMatch,
} from '@/lib/api';
import { formatDateTime, formatCoins, cn } from '@/lib/utils';
import {
  Shield, Flag, Users as UsersIcon, Activity, CheckCircle, XCircle,
  Gavel, RefreshCw, Play, Database, ChevronDown, AlertTriangle,
  Swords, Coins, Search, Zap, Trash2, ShieldCheck, Star, VolumeX,
  Eye, X as XIcon, TrendingUp, Receipt,
} from 'lucide-react';

type TabType = 'users' | 'risk' | 'transactions' | 'affiliates' | 'matches' | 'flagged' | 'players' | 'scrapers';

interface SuspiciousReferral {
  id: string;
  referredUser: { id: string; username: string; avatar: string | null; coins: number; isBanned: boolean } | null;
  referrer:     { id: string; username: string; avatar: string | null; coins: number; isBanned: boolean } | null;
  code: string;
  totalDeposited: number;
  totalWagered: number;
  commission: number;
  isActive: boolean;
  suspicious: boolean;
  suspiciousReason: string | null;
  reviewed: boolean;
  joinedAt: string;
}

interface AdminPlayer {
  id: string;
  name: string;
  aoe4worldId: string | null;
  winrate: number;
  totalGames: number;
  country: string | null;
  lastUpdatedAt: string;
  game?: string;
  aiEnrichedGames?: string[];
  _count: { matchHistory: number };
}

interface AdminMatch extends Match {
  _count?: { bets: number };
}

interface InspectBet {
  id: string;
  userId: string;
  amount: number;
  oddsAtBet: number;
  status: string;
  payout: number | null;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null; coins: number };
}

interface InspectData {
  match: AdminMatch & { boResults: Array<{ boNumber: number; winnerId: string | null; p1Civ: string | null; p2Civ: string | null }> };
  betsPlayer1: InspectBet[];
  betsPlayer2: InspectBet[];
  stats: { total: number; volume1: number; volume2: number; count1: number; count2: number; pct1: number; pct2: number };
}

interface ResultModal {
  matchId: string;
  player1Id: string;
  player2Id: string;
  player1Name: string;
  player2Name: string;
}

interface ScoreModal {
  matchId: string;
  player1Name: string;
  player2Name: string;
  currentP1: number;
  currentP2: number;
}

interface SuspiciousUser {
  id: string;
  username: string;
  avatar: string | null;
  coins: number;
  totalWagered: number;
  totalBets: number;
  wonBets: number;
  winrate: number;
  netProfit: number;
  isBanned: boolean;
  createdAt: string;
  lastActiveAt: string | null;
}

interface AdminTransaction {
  id: string;
  userId: string;
  type: string;
  amount: number;
  coins: number;
  status: string;
  createdAt: string;
  user: { id: string; username: string; avatar: string | null; coins: number; isBanned: boolean };
}

interface UserDetail {
  user: {
    id: string; username: string; email: string | null; avatar: string | null; bio: string | null;
    steamId: string | null; coins: number; totalWagered: number;
    isAdmin: boolean; isMod: boolean; isPartner: boolean; isBanned: boolean;
    mutedUntil: string | null; totpEnabled: boolean; provider: string;
    createdAt: string; lastActiveAt: string | null;
    counts: { bets: number; transactions: number; rouletteBets: number };
  };
  stats: {
    totalBets: number; wonBets: number; lostBets: number; winrate: number;
    totalWagered: number; totalWon: number; netProfit: number;
    bets24h: number; bets7d: number;
  };
  flags: Array<{ type: string; severity: 'low' | 'med' | 'high'; message: string }>;
  recentBets: Array<{
    id: string; amount: number; oddsAtBet: number; status: string; payout: number | null;
    selectedPlayer: number; createdAt: string;
    match: { id: string; status: string; winnerId: string | null; resultScore: string | null; scheduledAt: string;
      player1: { id: string; name: string }; player2: { id: string; name: string } };
  }>;
  recentTransactions: Array<{ id: string; type: string; amount: number; coins: number; status: string; createdAt: string }>;
}

export default function AdminPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [tab, setTab] = useState<TabType>('users');
  const [matches, setMatches] = useState<AdminMatch[]>([]);
  const [flagged, setFlagged] = useState<AdminMatch[]>([]);
  const [players, setPlayers] = useState<AdminPlayer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [resultModal, setResultModal] = useState<ResultModal | null>(null);
  const [resultForm, setResultForm] = useState({ winnerId: '', score: '' });
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [seeding, setSeeding] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [adjustModal, setAdjustModal] = useState<{ userId: string; username: string } | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [muteModal, setMuteModal] = useState<{ userId: string; username: string } | null>(null);
  const [muteDuration, setMuteDuration] = useState(15);
  const [inspectData, setInspectData] = useState<InspectData | null>(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [scoreModal, setScoreModal] = useState<ScoreModal | null>(null);
  const [scoreP1, setScoreP1] = useState('0');
  const [scoreP2, setScoreP2] = useState('0');
  const [lpDebug, setLpDebug] = useState<Record<string, unknown> | null>(null);
  const [suspiciousUsers, setSuspiciousUsers] = useState<SuspiciousUser[]>([]);
  const [suspiciousReferrals, setSuspiciousReferrals] = useState<SuspiciousReferral[]>([]);
  const [affiliateFilter, setAffiliateFilter] = useState<'suspicious' | 'pending' | 'all'>('pending');
  const [adminTransactions, setAdminTransactions] = useState<AdminTransaction[]>([]);
  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [userDetailLoading, setUserDetailLoading] = useState(false);
  const [txFilter, setTxFilter] = useState<'all' | 'pending' | 'deposit' | 'withdrawal'>('pending');

  const showMsg = (type: 'success' | 'error', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  useEffect(() => {
    if (status === 'loading') return;
    if (!session?.user.isAdmin) { router.push('/'); return; }
    if (session.user.accessToken) setAuthToken(session.user.accessToken);
    loadAll();
  }, [session, status]);

  // Auto-seed players with < 10 records when players tab is opened
  useEffect(() => {
    if (tab !== 'players' || players.length === 0) return;
    const needsSeed = players.some(p => p._count.matchHistory < 10);
    if (needsSeed) {
      apiClient.post('/admin/players/seed-all', {}).catch(() => {});
      // Refresh player data after 15s to show progress
      const t = setTimeout(() => apiClient.get('/admin/players').then(r => setPlayers(r.data.data ?? [])).catch(() => {}), 15000);
      return () => clearTimeout(t);
    }
  }, [tab, players]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [mRes, fRes, pRes, uRes, sRes, tRes, aRes] = await Promise.allSettled([
        apiClient.get('/admin/matches'),
        apiClient.get('/admin/matches/flagged'),
        apiClient.get('/admin/players'),
        getAdminUsers({ limit: 50 }),
        apiClient.get('/admin/suspicious'),
        apiClient.get('/admin/transactions?status=pending&limit=100'),
        apiClient.get('/admin/affiliate/referrals?filter=pending'),
      ]);
      if (mRes.status === 'fulfilled') setMatches(mRes.value.data.data ?? []);
      if (fRes.status === 'fulfilled') setFlagged(fRes.value.data.data ?? []);
      if (pRes.status === 'fulfilled') setPlayers(pRes.value.data.data ?? []);
      if (uRes.status === 'fulfilled') { setUsers(uRes.value.data); setUsersTotal(uRes.value.total); }
      if (sRes.status === 'fulfilled') setSuspiciousUsers(sRes.value.data.data ?? []);
      if (tRes.status === 'fulfilled') setAdminTransactions(tRes.value.data.data ?? []);
      if (aRes.status === 'fulfilled') setSuspiciousReferrals(aRes.value.data.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadAffiliateReferrals = async (filter: typeof affiliateFilter) => {
    setAffiliateFilter(filter);
    try {
      const res = await apiClient.get(`/admin/affiliate/referrals?filter=${filter}`);
      setSuspiciousReferrals(res.data.data ?? []);
    } catch { /* ignore */ }
  };

  const reviewReferral = async (id: string) => {
    try {
      await apiClient.post(`/admin/affiliate/referrals/${id}/review`, {});
      showMsg('success', 'Parrainage marqué comme validé');
      loadAffiliateReferrals(affiliateFilter);
    } catch {
      showMsg('error', 'Erreur');
    }
  };

  const revokeReferral = async (id: string) => {
    if (!confirm('Confisquer toute la commission gagnée sur ce filleul ?')) return;
    try {
      const res = await apiClient.post(`/admin/affiliate/referrals/${id}/revoke`, {});
      showMsg('success', `${res.data.revoked}⚜ confisqués`);
      loadAffiliateReferrals(affiliateFilter);
    } catch {
      showMsg('error', 'Erreur');
    }
  };

  const openUserDetail = async (userId: string) => {
    if (userDetailLoading) return; // guard against double-click
    setUserDetailLoading(true);
    setUserDetail(null);
    try {
      const res = await apiClient.get(`/admin/users/${userId}`);
      setUserDetail(res.data.data);
    } catch {
      showMsg('error', 'Impossible de charger le profil utilisateur');
    } finally {
      setUserDetailLoading(false);
    }
  };

  const loadTransactions = async (filter: typeof txFilter) => {
    setTxFilter(filter);
    const params = new URLSearchParams();
    if (filter === 'pending') params.set('status', 'pending');
    if (filter === 'deposit') params.set('type', 'deposit');
    if (filter === 'withdrawal') params.set('type', 'withdrawal');
    params.set('limit', '100');
    try {
      const res = await apiClient.get(`/admin/transactions?${params}`);
      setAdminTransactions(res.data.data ?? []);
    } catch {
      showMsg('error', 'Erreur chargement transactions');
    }
  };

  const handleSetResult = async () => {
    if (!resultModal || !resultForm.winnerId || !resultForm.score) return;
    setSubmitting(true);
    try {
      await setMatchResult(resultModal.matchId, { winnerId: resultForm.winnerId, resultScore: resultForm.score });
      showMsg('success', 'Résultat enregistré et gains distribués');
      setResultModal(null);
      setResultForm({ winnerId: '', score: '' });
      loadAll();
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (matchId: string) => {
    if (!confirm('Annuler ce match et rembourser tous les paris ?')) return;
    try {
      await cancelMatch(matchId);
      showMsg('success', 'Match annulé et paris remboursés');
      loadAll();
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleDelete = async (matchId: string) => {
    if (!confirm('Supprimer définitivement ce match ? Les paris seront remboursés.')) return;
    try {
      await deleteMatch(matchId);
      showMsg('success', 'Match supprimé');
      loadAll();
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleBan = async (userId: string, isBanned: boolean) => {
    try {
      await banUser(userId, !isBanned);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, isBanned: !isBanned } : u));
      showMsg('success', `Utilisateur ${isBanned ? 'débanni' : 'banni'}`);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleSetRole = async (userId: string, role: 'isMod' | 'isPartner' | 'isAdmin', currentValue: boolean) => {
    try {
      await apiClient.post(`/admin/users/${userId}/role`, { role, value: !currentValue });
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, [role]: !currentValue } : u));
      showMsg('success', `Rôle mis à jour`);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleMute = async () => {
    if (!muteModal) return;
    try {
      await apiClient.post(`/admin/users/${muteModal.userId}/mute`, { durationMinutes: muteDuration });
      showMsg('success', `${muteModal.username} muté ${muteDuration} min`);
      setMuteModal(null);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleAdjustCoins = async () => {
    if (!adjustModal || !adjustAmount) return;
    try {
      await apiClient.post(`/admin/users/${adjustModal.userId}/adjust-coins`, {
        amount: parseInt(adjustAmount),
        reason: 'Admin adjustment',
      });
      showMsg('success', `Coins ajustés pour ${adjustModal.username}`);
      setAdjustModal(null);
      setAdjustAmount('');
      loadAll();
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleSeedPlayer = async (playerId: string, playerName: string, source: 'all' | 'ai' | 'aoe4world' = 'all', game?: string) => {
    setSeeding(playerId);
    try {
      await apiClient.post(`/admin/players/${playerId}/seed-history`, { force: true, source, ...(game ? { game } : {}) });
      const label = source === 'ai' ? 'Claude AI' : source === 'aoe4world' ? 'aoe4world' : 'toutes sources';
      showMsg('success', `Seed ${playerName} via ${label}${game ? ` (${game})` : ''}`);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSeeding(null);
    }
  };

  const handleSeedAll = async () => {
    setSeeding('all');
    try {
      await apiClient.post('/admin/players/seed-all', {});
      showMsg('success', 'Seeding de tous les joueurs démarré en background');
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    } finally {
      setSeeding(null);
    }
  };

  const handleSetScore = async () => {
    if (!scoreModal) return;
    try {
      await apiClient.post(`/admin/matches/${scoreModal.matchId}/score`, {
        p1Score: parseInt(scoreP1),
        p2Score: parseInt(scoreP2),
      });
      showMsg('success', `Score mis à jour : ${scoreP1}-${scoreP2}`);
      setScoreModal(null);
      loadAll();
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    }
  };

  const handleLpDebug = async (matchId: string) => {
    try {
      const res = await apiClient.get(`/admin/matches/${matchId}/lp-debug`);
      setLpDebug(res.data);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur LP debug');
    }
  };

  const handleInspect = async (matchId: string) => {
    setInspectLoading(true);
    try {
      const res = await apiClient.get(`/admin/matches/${matchId}/inspect`);
      setInspectData(res.data.data);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur inspection');
    } finally {
      setInspectLoading(false);
    }
  };

  // Defer the search value so typing stays responsive while the table
  // re-renders at a lower priority. Memoize the filtered list to avoid
  // re-computing on unrelated state updates.
  const deferredUserSearch = useDeferredValue(userSearch);
  const filteredUsers = useMemo(
    () => users.filter(u =>
      !deferredUserSearch || u.username.toLowerCase().includes(deferredUserSearch.toLowerCase())
    ),
    [users, deferredUserSearch]
  );

  // Only spinner on the very first load (no session resolved yet)
  if (status === 'loading' && !session) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
      <div className="w-8 h-8 border-2 border-[#ffc542] border-t-transparent rounded-full animate-spin" />
    </div>
  );
  if (!session?.user.isAdmin) return null;

  const tabs: { id: TabType; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'users', label: 'Utilisateurs', icon: UsersIcon, count: usersTotal },
    { id: 'risk', label: 'Risque', icon: AlertTriangle, count: suspiciousUsers.length },
    { id: 'transactions', label: 'Transactions', icon: Receipt, count: adminTransactions.filter(t => t.status === 'pending').length },
    { id: 'affiliates', label: 'Affiliés', icon: Zap, count: suspiciousReferrals.filter(r => !r.reviewed).length },
    { id: 'matches', label: 'Matchs', icon: Swords, count: matches.length },
    { id: 'flagged', label: 'Flaggés', icon: Flag, count: flagged.length },
    { id: 'players', label: 'Joueurs', icon: Database, count: players.length },
    { id: 'scrapers', label: 'Scrapers', icon: Activity },
  ];

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>

      {/* Header */}
      <div style={{ background: '#0d0b1a', borderBottom: '1px solid #1e1a30' }} className="px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: '#be123c22', border: '1px solid #be123c55' }}>
              <Shield size={16} className="text-red-400" />
            </div>
            <div>
              <h1 className="font-bold text-[15px] text-[#e8e2f5]" style={{ fontFamily: 'Cinzel, serif' }}>
                ADMINISTRATION
              </h1>
              <p className="text-[11px] text-[#6b6488]">AgeOfMoney — Panel Admin</p>
            </div>
          </div>
          <button onClick={loadAll} className="flex items-center gap-2 text-[#6b6488] hover:text-[#e8e2f5] transition-colors text-[12px]">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Rafraîchir
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Toast */}
        {msg && (
          <div className={cn(
            'flex items-center gap-2 p-3 rounded-lg mb-4 text-[12px]',
            msg.type === 'success'
              ? 'bg-emerald-950 border border-emerald-800/40 text-emerald-400'
              : 'bg-red-950 border border-red-800/40 text-red-400'
          )}>
            {msg.type === 'success' ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {msg.text}
            <button onClick={() => setMsg(null)} className="ml-auto opacity-60 hover:opacity-100">×</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid #1e1a30' }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-[12px] font-medium transition-all border-b-2 -mb-px',
                tab === t.id
                  ? 'border-[#ffc542] text-[#ffc542]'
                  : 'border-transparent text-[#6b6488] hover:text-[#c8c0e0]'
              )}
            >
              <t.icon size={13} />
              {t.label}
              {t.count !== undefined && (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                  style={{ background: tab === t.id ? '#ffc54222' : '#1e1a30', color: tab === t.id ? '#ffc542' : '#6b6488' }}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ── MATCHES TAB ────────────────────────────────────────────────── */}
        {tab === 'matches' && (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
              <Swords size={14} className="text-[#ffc542]" />
              <span className="text-[13px] font-semibold text-[#ffc542]">MATCHS ACTIFS</span>
              <span className="ml-auto text-[11px] text-[#6b6488]">{matches.length} match(s)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                    {['Match', 'Tournoi', 'Format', 'Statut', 'Cotes', 'Paris', 'Date', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matches.map(m => (
                    <tr key={m.id} className="hover:bg-[#13111f] transition-colors" style={{ borderBottom: '1px solid #1e1a3022' }}>
                      <td className="px-4 py-3">
                        <p className="font-semibold text-[#e8e2f5]">{m.player1.name}</p>
                        <p className="text-[#6b6488] text-[11px]">vs {m.player2.name}</p>
                      </td>
                      <td className="px-4 py-3 text-[#9990b8]">{m.tournament?.name ?? ''}</td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold text-[#ffc542]" style={{ background: '#ffc54215', border: '1px solid #ffc54230' }}>
                          {m.format}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          'px-2 py-0.5 rounded text-[10px] font-bold',
                          m.status === 'LIVE' ? 'bg-emerald-950 border border-emerald-800/40 text-emerald-400' : 'bg-[#1e1a30] text-[#9990b8]'
                        )}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#9990b8] font-mono text-[11px]">
                        {m.odds1?.toFixed(2)} / {m.odds2?.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-[#9990b8]">{m._count?.bets ?? 0}</td>
                      <td className="px-4 py-3 text-[#6b6488] whitespace-nowrap">
                        {formatDateTime(m.scheduledAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleInspect(m.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all hover:opacity-90"
                            style={{ background: '#0891b215', border: '1px solid #0891b240', color: '#38bdf8' }}
                            title="Inspecter le match"
                          >
                            <Eye size={11} />
                            Inspecter
                          </button>
                          {m.status === 'LIVE' && (
                            <>
                              <button
                                onClick={async () => {
                                  try {
                                    await apiClient.post(`/admin/matches/${m.id}/sync-liquipedia`);
                                    showMsg('success', 'Sync Liquipedia déclenché');
                                    setTimeout(loadAll, 4000);
                                  } catch (err) {
                                    showMsg('error', err instanceof Error ? err.message : 'Erreur');
                                  }
                                }}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all hover:opacity-90"
                                style={{ background: '#7c3aed15', border: '1px solid #7c3aed40', color: '#a78bfa' }}
                                title="Sync score depuis Liquipedia"
                              >
                                <RefreshCw size={11} />
                                LP
                              </button>
                              <button
                                onClick={() => handleLpDebug(m.id)}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all hover:opacity-90"
                                style={{ background: '#0f172a', border: '1px solid #7c3aed60', color: '#c084fc' }}
                                title="Diagnostiquer le scraping LP"
                              >
                                <Search size={11} />
                                LP Debug
                              </button>
                              <button
                                onClick={() => {
                                  setScoreP1(String(m.p1Score ?? 0));
                                  setScoreP2(String(m.p2Score ?? 0));
                                  setScoreModal({ matchId: m.id, player1Name: m.player1.name, player2Name: m.player2.name, currentP1: m.p1Score ?? 0, currentP2: m.p2Score ?? 0 });
                                }}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all hover:opacity-90"
                                style={{ background: '#10b98115', border: '1px solid #10b98140', color: '#10b981' }}
                                title="Définir le score BO manuellement"
                              >
                                <Zap size={11} />
                                Score
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => setResultModal({ matchId: m.id, player1Id: m.player1Id, player2Id: m.player2Id, player1Name: m.player1.name, player2Name: m.player2.name })}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all hover:opacity-90"
                            style={{ background: '#ffc54220', border: '1px solid #ffc54240', color: '#ffc542' }}
                          >
                            <Gavel size={11} />
                            Résultat
                          </button>
                          <button
                            onClick={() => handleCancel(m.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all hover:opacity-90"
                            style={{ background: '#be123c15', border: '1px solid #be123c30', color: '#f87171' }}
                            title="Annuler (rembourser)"
                          >
                            Annuler
                          </button>
                          <button
                            onClick={() => handleDelete(m.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-all hover:opacity-90"
                            style={{ background: '#7f1d1d30', border: '1px solid #7f1d1d60', color: '#ef4444' }}
                            title="Supprimer définitivement"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {matches.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-10 text-center text-[#6b6488]">Aucun match actif</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── FLAGGED TAB ───────────────────────────────────────────────── */}
        {tab === 'flagged' && (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
              <Flag size={14} className="text-amber-400" />
              <span className="text-[13px] font-semibold text-amber-400">MATCHS FLAGGÉS</span>
              {flagged.length === 0 && <span className="ml-2 text-[11px] text-emerald-400 flex items-center gap-1"><CheckCircle size={11} />Tout est en ordre</span>}
            </div>
            {flagged.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                      {['Match', 'Tournoi', 'Format', 'Date', 'Paris', 'Action'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.map(m => (
                      <tr key={m.id} className="hover:bg-[#13111f]" style={{ borderBottom: '1px solid #1e1a3022' }}>
                        <td className="px-4 py-3 font-semibold text-[#e8e2f5]">{m.player1.name} vs {m.player2.name}</td>
                        <td className="px-4 py-3 text-[#9990b8]">{m.tournament?.name ?? ''}</td>
                        <td className="px-4 py-3 text-[#ffc542] font-bold text-[11px]">{m.format}</td>
                        <td className="px-4 py-3 text-[#6b6488]">{formatDateTime(m.scheduledAt)}</td>
                        <td className="px-4 py-3 text-[#9990b8]">{(m as AdminMatch)._count?.bets ?? 0}</td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setResultModal({ matchId: m.id, player1Id: m.player1Id, player2Id: m.player2Id, player1Name: m.player1.name, player2Name: m.player2.name })}
                            className="flex items-center gap-1 px-3 py-1.5 rounded text-[11px] font-medium"
                            style={{ background: '#ffc54220', border: '1px solid #ffc54240', color: '#ffc542' }}
                          >
                            <Gavel size={11} />
                            Résultat
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-[#6b6488] text-[13px]">Aucun match flaggé</div>
            )}
          </div>
        )}

        {/* ── PLAYERS TAB ───────────────────────────────────────────────── */}
        {tab === 'players' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[12px] text-[#6b6488]">{players.length} joueurs — historique mis à jour automatiquement via aoe4world + Claude AI</p>
              <button
                onClick={handleSeedAll}
                disabled={seeding === 'all'}
                className="flex items-center gap-2 px-4 py-2 rounded text-[12px] font-medium transition-all disabled:opacity-50"
                style={{ background: '#ffc54220', border: '1px solid #ffc54240', color: '#ffc542' }}
              >
                {seeding === 'all' ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                Seed tous les joueurs
              </button>
            </div>

            {/* Quick fix: manually set tournament game (cascades to matches) */}
            <div className="rounded-lg p-3" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
              <p className="text-[11px] text-[#6b6488] mb-2 uppercase tracking-wider">🔧 Forcer le jeu d&apos;un tournoi (override classification)</p>
              <form
                className="flex items-center gap-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const nameInput = form.elements.namedItem('tname') as HTMLInputElement;
                  const gameSelect = form.elements.namedItem('tgame') as HTMLSelectElement;
                  if (!nameInput.value || !gameSelect.value) return;
                  try {
                    const r = await apiClient.post('/admin/tournaments/set-game', {
                      name: nameInput.value,
                      game: gameSelect.value,
                    });
                    const data = r.data as { tournamentsUpdated: number; matchesUpdated: number };
                    showMsg('success', `${data.tournamentsUpdated} tournoi(s) → ${gameSelect.value} (${data.matchesUpdated} matchs cascadés)`);
                    nameInput.value = '';
                    fetchAll();
                  } catch (err) {
                    showMsg('error', err instanceof Error ? err.message : 'Erreur');
                  }
                }}
              >
                <input
                  name="tname"
                  placeholder="Nom du tournoi (ex: Brazilian Dynasty)"
                  className="flex-1 px-3 py-2 rounded text-[12px] outline-none text-[#e8e2f5] placeholder:text-[#3d3860]"
                  style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
                />
                <select
                  name="tgame"
                  defaultValue=""
                  className="px-2 py-2 rounded text-[12px] outline-none text-[#e8e2f5]"
                  style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}
                  required
                >
                  <option value="" disabled>Jeu…</option>
                  <option value="AoE1">AoE1</option>
                  <option value="AoE2">AoE2</option>
                  <option value="AoE3">AoE3</option>
                  <option value="AoE4">AoE4</option>
                  <option value="AoM">AoM</option>
                </select>
                <button
                  type="submit"
                  className="px-4 py-2 rounded text-[12px] font-medium"
                  style={{ background: '#ffc54220', border: '1px solid #ffc54240', color: '#ffc542' }}
                >
                  Appliquer
                </button>
              </form>
            </div>

            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                    {['Joueur', 'Winrate', 'Pays', 'Records DB', 'Dernière MAJ', 'Action'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {players.map(p => {
                    const records = p._count.matchHistory;
                    const color = records >= 50 ? '#10b981' : records >= 20 ? '#ffc542' : records > 0 ? '#f87171' : '#6b6488';
                    const enrichedGames = p.aiEnrichedGames ?? [];
                    const aiDone = enrichedGames.length > 0;
                    return (
                      <tr key={p.id} className="hover:bg-[#13111f] transition-colors" style={{ borderBottom: '1px solid #1e1a3022' }}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-[#e8e2f5]">{p.name}</p>
                            {p.game && p.game !== 'AoE4' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-cinzel"
                                style={{ background: '#1e1a30', border: '1px solid #2a2540', color: '#9990b8' }}>
                                {p.game}
                              </span>
                            )}
                            {aiDone && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded font-cinzel inline-flex items-center gap-1"
                                style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.3)', color: '#22d3ee' }}
                                title={`Claude AI a déjà été appelé pour: ${enrichedGames.join(', ')}`}>
                                🤖 AI ✓ {enrichedGames.join('+')}
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-[#6b6488]">{p.aoe4worldId ?? 'no aoe4world ID'}</p>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn('font-bold', (p.winrate ?? 0) >= 0.55 ? 'text-emerald-400' : (p.winrate ?? 0) >= 0.45 ? 'text-[#ffc542]' : 'text-red-400')}>
                            {((p.winrate ?? 0) * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#9990b8]">{p.country ?? ''}</td>
                        <td className="px-4 py-3">
                          <span className="font-bold text-[13px]" style={{ color }}>
                            {records}/50
                          </span>
                          <div className="w-16 h-1 rounded-full mt-1" style={{ background: '#1e1a30' }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (records / 50) * 100)}%`, background: color }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[#6b6488] text-[11px]">
                          {new Date(p.lastUpdatedAt).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 flex-wrap">
                            {/* Liquipedia scraper — direct match history from LP /Matches page */}
                            <button
                              onClick={() => handleSeedPlayer(p.id, p.name, 'liquipedia')}
                              disabled={seeding === p.id}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all disabled:opacity-40"
                              style={{ background: 'rgba(255,197,66,0.08)', border: '1px solid rgba(255,197,66,0.2)', color: '#ffc542' }}
                              title="Seed via Liquipedia /Matches page (S/A tier tournament results)"
                            >
                              {seeding === p.id ? <RefreshCw size={10} className="animate-spin" /> : <>📖</>}
                              LP
                            </button>
                            {/* AI seed — Claude Opus (all games, uses Liquipedia knowledge) */}
                            <button
                              onClick={() => handleSeedPlayer(p.id, p.name, 'ai')}
                              disabled={seeding === p.id}
                              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all disabled:opacity-40"
                              style={{ background: 'rgba(34,211,238,0.08)', border: '1px solid rgba(34,211,238,0.2)', color: '#22d3ee' }}
                              title="Seed via Claude AI (esport knowledge)"
                            >
                              🤖 AI
                            </button>
                            {/* aoe4world seed (AoE4 only) */}
                            {p.aoe4worldId && (
                              <button
                                onClick={() => handleSeedPlayer(p.id, p.name, 'aoe4world')}
                                disabled={seeding === p.id}
                                className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all disabled:opacity-40"
                                style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981' }}
                                title="Seed via aoe4world API (AoE4 real match data)"
                              >
                                🌐 aoe4w
                              </button>
                            )}
                            {/* Game override selector */}
                            <select
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) {
                                  handleSeedPlayer(p.id, p.name, 'ai', e.target.value);
                                  e.target.value = '';
                                }
                              }}
                              disabled={seeding === p.id}
                              className="px-1 py-1 rounded text-[9px] font-medium outline-none disabled:opacity-40"
                              style={{ background: '#13111f', border: '1px solid #1e1a30', color: '#6b6488' }}
                              title="Force AI seed pour un jeu spécifique"
                            >
                              <option value="">jeu…</option>
                              <option value="AoE2">AoE2</option>
                              <option value="AoE4">AoE4</option>
                              <option value="AoE3">AoE3</option>
                              <option value="AoM">AoM</option>
                            </select>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── USERS TAB ─────────────────────────────────────────────────── */}
        {tab === 'users' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-xs">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#6b6488]" />
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Rechercher un utilisateur…"
                  className="w-full pl-8 pr-3 py-2 rounded-lg text-[12px] text-[#e8e2f5] placeholder:text-[#3d3860] outline-none"
                  style={{ background: '#13111f', border: '1px solid #1e1a30' }}
                />
              </div>
              <span className="text-[12px] text-[#6b6488]">{usersTotal} utilisateurs</span>
            </div>

            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                    {['Utilisateur', 'Coins', 'Rôles', 'Statut', 'Dernière activité', 'Actions'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredUsers.map(u => (
                    <tr key={u.id} className="hover:bg-[#13111f] transition-colors" style={{ borderBottom: '1px solid #1e1a3022' }}>
                      <td className="px-4 py-3">
                        <button onClick={() => openUserDetail(u.id)} className="flex items-center gap-2 hover:opacity-80 transition-opacity text-left">
                          {u.avatar && <Image src={u.avatar} alt="" width={28} height={28} unoptimized className="w-7 h-7 rounded-full" />}
                          <div>
                            <p className="font-semibold text-[#e8e2f5] hover:text-[#ffc542] transition-colors">{u.username}</p>
                            <p className="text-[10px] text-[#6b6488] capitalize">{u.provider}</p>
                          </div>
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-[#ffc542]">{new Intl.NumberFormat('fr-FR').format(u.coins)} ⚜</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {u.isAdmin && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-950 border border-red-800/40 text-red-400">ADMIN</span>}
                          {(u as User & { isMod?: boolean }).isMod && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#1e3a5f', border: '1px solid #3b82f640', color: '#60a5fa' }}>MOD</span>}
                          {(u as User & { isPartner?: boolean }).isPartner && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#2d1b4e', border: '1px solid #a855f740', color: '#c084fc' }}>PARTNER</span>}
                          {!u.isAdmin && !(u as User & { isMod?: boolean }).isMod && !(u as User & { isPartner?: boolean }).isPartner && <span className="text-[#6b6488] text-[11px]">Joueur</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold',
                          u.isBanned ? 'bg-red-950 border border-red-800/40 text-red-400' : 'bg-emerald-950 border border-emerald-800/40 text-emerald-400'
                        )}>
                          {u.isBanned ? 'Banni' : 'Actif'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6b6488] whitespace-nowrap">
                        {u.lastActiveAt ? formatDateTime(u.lastActiveAt) : ''}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 flex-wrap">
                          <button onClick={() => openUserDetail(u.id)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all"
                            title="Inspecter l'activité complète"
                            style={{ background: '#ffc54215', border: '1px solid #ffc54240', color: '#ffc542' }}>
                            <Eye size={11} /> Inspecter
                          </button>
                          {!u.isAdmin && (
                            <button onClick={() => handleBan(u.id, u.isBanned ?? false)}
                              className={cn('px-2 py-1 rounded text-[10px] font-medium transition-all',
                                u.isBanned ? 'bg-emerald-950 border border-emerald-800/40 text-emerald-400' : 'bg-red-950 border border-red-800/40 text-red-400'
                              )}>
                              {u.isBanned ? 'Débannir' : 'Bannir'}
                            </button>
                          )}
                          <button onClick={() => setAdjustModal({ userId: u.id, username: u.username })}
                            className="p-1.5 rounded transition-all" title="Ajuster coins"
                            style={{ background: '#ffc54215', border: '1px solid #ffc54230', color: '#ffc542' }}>
                            <Coins size={11} />
                          </button>
                          {/* Mod toggle */}
                          <button onClick={() => handleSetRole(u.id, 'isMod', !!(u as User & { isMod?: boolean }).isMod)}
                            className="p-1.5 rounded transition-all" title={`${(u as User & { isMod?: boolean }).isMod ? 'Retirer' : 'Donner'} Mod`}
                            style={{ background: (u as User & { isMod?: boolean }).isMod ? '#1e3a5f' : '#13111f', border: `1px solid ${(u as User & { isMod?: boolean }).isMod ? '#3b82f6' : '#2a2640'}`, color: (u as User & { isMod?: boolean }).isMod ? '#60a5fa' : '#4a4468' }}>
                            <ShieldCheck size={11} />
                          </button>
                          {/* Partner toggle */}
                          <button onClick={() => handleSetRole(u.id, 'isPartner', !!(u as User & { isPartner?: boolean }).isPartner)}
                            className="p-1.5 rounded transition-all" title={`${(u as User & { isPartner?: boolean }).isPartner ? 'Retirer' : 'Donner'} Partner`}
                            style={{ background: (u as User & { isPartner?: boolean }).isPartner ? '#2d1b4e' : '#13111f', border: `1px solid ${(u as User & { isPartner?: boolean }).isPartner ? '#a855f7' : '#2a2640'}`, color: (u as User & { isPartner?: boolean }).isPartner ? '#c084fc' : '#4a4468' }}>
                            <Star size={11} />
                          </button>
                          {/* Mute */}
                          <button onClick={() => setMuteModal({ userId: u.id, username: u.username })}
                            className="p-1.5 rounded transition-all" title="Muter"
                            style={{ background: '#13111f', border: '1px solid #2a2640', color: '#6b6488' }}>
                            <VolumeX size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── RISK TAB ──────────────────────────────────────────────────── */}
        {tab === 'risk' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <AlertTriangle size={16} className="text-red-400" />
              <h2 className="font-bold text-[14px] text-[#e8e2f5]">Utilisateurs à risque</h2>
              <span className="text-[11px] text-[#6b6488]">· Winrate &gt; 75% ou profit net &gt; 20 000 ⚜</span>
            </div>
            {suspiciousUsers.length === 0 ? (
              <div className="rounded-lg p-6 text-center" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                <CheckCircle size={24} className="text-emerald-400 mx-auto mb-2" />
                <p className="text-[#6b6488] text-[13px]">Aucun utilisateur suspect détecté</p>
              </div>
            ) : (
              <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
                <table className="w-full text-[12px]">
                  <thead>
                    <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                      {['Utilisateur', 'Paris', 'Winrate', 'Misé', 'Profit net', 'Solde', 'Statut', 'Actions'].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {suspiciousUsers.map(u => (
                      <tr key={u.id} className="hover:bg-[#13111f] transition-colors" style={{ borderBottom: '1px solid #1e1a3022' }}>
                        <td className="px-4 py-3">
                          <button onClick={() => openUserDetail(u.id)} className="flex items-center gap-2 hover:opacity-80">
                            {u.avatar && <Image src={u.avatar} alt="" width={28} height={28} unoptimized className="w-7 h-7 rounded-full" />}
                            <p className="font-semibold text-[#e8e2f5] hover:text-[#ffc542]">{u.username}</p>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-[#e8e2f5]">{u.totalBets}</td>
                        <td className="px-4 py-3">
                          <span className={cn('font-bold', u.winrate > 0.80 ? 'text-red-400' : u.winrate > 0.70 ? 'text-orange-400' : 'text-[#e8e2f5]')}>
                            {(u.winrate * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#6b6488]">{new Intl.NumberFormat('fr-FR').format(u.totalWagered)} ⚜</td>
                        <td className="px-4 py-3">
                          <span className={cn('font-bold', u.netProfit > 50000 ? 'text-red-400' : u.netProfit > 0 ? 'text-emerald-400' : 'text-[#6b6488]')}>
                            {u.netProfit > 0 ? '+' : ''}{new Intl.NumberFormat('fr-FR').format(u.netProfit)} ⚜
                          </span>
                        </td>
                        <td className="px-4 py-3 text-[#ffc542] font-bold">{new Intl.NumberFormat('fr-FR').format(u.coins)} ⚜</td>
                        <td className="px-4 py-3">
                          <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold',
                            u.isBanned ? 'bg-red-950 border border-red-800/40 text-red-400' : 'bg-emerald-950 border border-emerald-800/40 text-emerald-400'
                          )}>
                            {u.isBanned ? 'Banni' : 'Actif'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <button onClick={() => openUserDetail(u.id)}
                            className="px-2 py-1 rounded text-[10px] font-medium" style={{ background: '#ffc54215', border: '1px solid #ffc54230', color: '#ffc542' }}>
                            <Eye size={11} className="inline -mt-0.5" /> Inspecter
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── TRANSACTIONS TAB ──────────────────────────────────────────── */}
        {tab === 'transactions' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1 p-0.5 rounded" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                {(['pending', 'all', 'deposit', 'withdrawal'] as const).map(f => (
                  <button key={f} onClick={() => loadTransactions(f)}
                    className={cn('px-3 py-1 rounded text-[11px] font-medium transition-colors',
                      txFilter === f ? 'bg-[#ffc542] text-black' : 'text-[#9990b8] hover:text-[#e8e2f5]'
                    )}>
                    {f === 'pending' ? 'En attente' : f === 'all' ? 'Toutes' : f === 'deposit' ? 'Dépôts' : 'Retraits'}
                  </button>
                ))}
              </div>
              <span className="text-[12px] text-[#6b6488]">{adminTransactions.length} transaction(s)</span>
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                    {['Utilisateur', 'Type', 'Montant USD', 'Coins', 'Statut', 'Date'].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {adminTransactions.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-[#6b6488] py-8">Aucune transaction</td></tr>
                  ) : adminTransactions.map(tx => (
                    <tr key={tx.id} className="hover:bg-[#13111f]" style={{ borderBottom: '1px solid #1e1a3022' }}>
                      <td className="px-4 py-3">
                        <button onClick={() => openUserDetail(tx.user.id)} className="flex items-center gap-2 hover:opacity-80">
                          {tx.user.avatar && <Image src={tx.user.avatar} alt="" width={24} height={24} unoptimized className="w-6 h-6 rounded-full" />}
                          <span className="font-semibold text-[#e8e2f5] hover:text-[#ffc542]">{tx.user.username}</span>
                          {tx.user.isBanned && <span className="text-[9px] text-red-400">BANNI</span>}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold uppercase',
                          tx.type === 'deposit' ? 'bg-emerald-950 border border-emerald-800/40 text-emerald-400' :
                          tx.type === 'withdrawal' ? 'bg-orange-950 border border-orange-800/40 text-orange-400' :
                          'bg-blue-950 border border-blue-800/40 text-blue-400'
                        )}>
                          {tx.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#e8e2f5]">${(tx.amount / 100).toFixed(2)}</td>
                      <td className="px-4 py-3 text-[#ffc542] font-bold">{tx.coins > 0 ? '+' : ''}{new Intl.NumberFormat('fr-FR').format(tx.coins)} ⚜</td>
                      <td className="px-4 py-3">
                        <span className={cn('px-2 py-0.5 rounded text-[10px] font-bold',
                          tx.status === 'completed' ? 'bg-emerald-950 border border-emerald-800/40 text-emerald-400' :
                          tx.status === 'pending' ? 'bg-amber-950 border border-amber-800/40 text-amber-400' :
                          'bg-red-950 border border-red-800/40 text-red-400'
                        )}>
                          {tx.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[#6b6488] whitespace-nowrap">{formatDateTime(tx.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── AFFILIATES TAB ────────────────────────────────────────────── */}
        {tab === 'affiliates' && (
          <div className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1 p-0.5 rounded" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                {(['pending', 'suspicious', 'all'] as const).map(f => (
                  <button key={f} onClick={() => loadAffiliateReferrals(f)}
                    className={cn('px-3 py-1 rounded text-[11px] font-medium transition-colors',
                      affiliateFilter === f ? 'bg-[#ffc542] text-black' : 'text-[#9990b8] hover:text-[#e8e2f5]'
                    )}>
                    {f === 'pending' ? 'À review' : f === 'suspicious' ? 'Tous suspects' : 'Tous'}
                  </button>
                ))}
              </div>
              <span className="text-[12px] text-[#6b6488]">{suspiciousReferrals.length} parrainage(s)</span>
              <p className="text-[10px] text-[#4a4468] flex-1">
                🚩 Flag automatique : parrain et filleul partagent une IP (possible double compte)
              </p>
            </div>
            <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
              <table className="w-full text-[12px]">
                <thead>
                  <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                    {['Parrain', 'Filleul', 'Code', 'Déposé', 'Misé', 'Commission', 'Raison', 'Actions'].map(h => (
                      <th key={h} className="text-left px-3 py-2.5 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {suspiciousReferrals.length === 0 ? (
                    <tr><td colSpan={8} className="text-center text-[#6b6488] py-8">Aucun parrainage suspect 👌</td></tr>
                  ) : suspiciousReferrals.map(r => (
                    <tr key={r.id} className="hover:bg-[#13111f]" style={{ borderBottom: '1px solid #1e1a3022' }}>
                      <td className="px-3 py-3">
                        {r.referrer ? (
                          <button onClick={() => openUserDetail(r.referrer!.id)} className="flex items-center gap-2 hover:opacity-80">
                            {r.referrer.avatar && <Image src={r.referrer.avatar} alt="" width={24} height={24} unoptimized className="w-6 h-6 rounded-full" />}
                            <span className="text-[#e8e2f5] hover:text-[#ffc542]">{r.referrer.username}</span>
                            {r.referrer.isBanned && <span className="text-[9px] text-red-400">BANNI</span>}
                          </button>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3">
                        {r.referredUser ? (
                          <button onClick={() => openUserDetail(r.referredUser!.id)} className="flex items-center gap-2 hover:opacity-80">
                            {r.referredUser.avatar && <Image src={r.referredUser.avatar} alt="" width={24} height={24} unoptimized className="w-6 h-6 rounded-full" />}
                            <span className="text-[#e8e2f5] hover:text-[#ffc542]">{r.referredUser.username}</span>
                            {r.referredUser.isBanned && <span className="text-[9px] text-red-400">BANNI</span>}
                          </button>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3 font-mono text-[#ffc542]">{r.code}</td>
                      <td className="px-3 py-3 text-[#e8e2f5]">{r.totalDeposited.toLocaleString('fr-FR')}⚜</td>
                      <td className="px-3 py-3 text-[#8a82a8]">{r.totalWagered.toLocaleString('fr-FR')}⚜</td>
                      <td className="px-3 py-3 text-[#ffc542] font-bold">{r.commission.toLocaleString('fr-FR')}⚜</td>
                      <td className="px-3 py-3 text-[11px]">
                        {r.suspicious && !r.reviewed && (
                          <span className="px-2 py-0.5 rounded bg-red-950 border border-red-800/40 text-red-400 text-[10px] font-bold">
                            🚩 {r.suspiciousReason ?? 'Suspect'}
                          </span>
                        )}
                        {r.suspicious && r.reviewed && (
                          <span className="px-2 py-0.5 rounded bg-emerald-950 border border-emerald-800/40 text-emerald-400 text-[10px] font-bold">
                            ✓ Validé
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        {!r.reviewed && (
                          <div className="flex gap-1">
                            <button onClick={() => reviewReferral(r.id)}
                              className="px-2 py-1 rounded text-[10px] font-bold bg-emerald-950 border border-emerald-800/40 text-emerald-400 hover:bg-emerald-900">
                              Valider
                            </button>
                            <button onClick={() => revokeReferral(r.id)}
                              className="px-2 py-1 rounded text-[10px] font-bold bg-red-950 border border-red-800/40 text-red-400 hover:bg-red-900">
                              Confisquer
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── SCRAPERS TAB ──────────────────────────────────────────────── */}
        {tab === 'scrapers' && <ScrapersPanel showMsg={showMsg} />}
      </div>

      {/* ── USER DETAIL MODAL ───────────────────────────────────────────── */}
      {(userDetail || userDetailLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4" onClick={() => { setUserDetail(null); }}>
          <div className="rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }} onClick={e => e.stopPropagation()}>
            {userDetailLoading ? (
              <div className="p-12 text-center text-[#6b6488]">Chargement...</div>
            ) : userDetail && (
              <>
                <div className="flex items-start justify-between gap-4 p-5" style={{ borderBottom: '1px solid #1e1a30' }}>
                  <div className="flex items-center gap-3">
                    {userDetail.user.avatar && <Image src={userDetail.user.avatar} alt="" width={48} height={48} unoptimized className="w-12 h-12 rounded-full" />}
                    <div>
                      <div className="flex items-center gap-2">
                        <h2 className="font-bold text-[16px] text-[#e8e2f5]">{userDetail.user.username}</h2>
                        {userDetail.user.isAdmin && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-950 border border-red-800/40 text-red-400">ADMIN</span>}
                        {userDetail.user.isMod && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#1e3a5f', border: '1px solid #3b82f640', color: '#60a5fa' }}>MOD</span>}
                        {userDetail.user.isPartner && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#2d1b4e', border: '1px solid #a855f740', color: '#c084fc' }}>PARTNER</span>}
                        {userDetail.user.isBanned && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-red-950 border border-red-800/40 text-red-400">BANNI</span>}
                        {userDetail.user.totpEnabled && <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-950 border border-emerald-800/40 text-emerald-400">2FA</span>}
                      </div>
                      <p className="text-[11px] text-[#6b6488]">
                        {userDetail.user.email ?? '—'} · {userDetail.user.provider} · Membre depuis {formatDateTime(userDetail.user.createdAt)}
                      </p>
                      {userDetail.user.steamId && <p className="text-[10px] text-[#4a4468] font-mono">Steam: {userDetail.user.steamId}</p>}
                    </div>
                  </div>
                  <button onClick={() => setUserDetail(null)} className="text-[#6b6488] hover:text-[#e8e2f5]">
                    <XIcon size={18} />
                  </button>
                </div>

                <div className="overflow-y-auto flex-1 p-5 space-y-4">
                  {/* Flags */}
                  {userDetail.flags.length > 0 && (
                    <div className="rounded-lg p-3" style={{ background: '#13111f', border: '1px solid #ef444430' }}>
                      <div className="flex items-center gap-2 mb-2">
                        <AlertTriangle size={13} className="text-red-400" />
                        <span className="text-[11px] font-bold text-red-400 uppercase">Alertes</span>
                      </div>
                      <div className="space-y-1">
                        {userDetail.flags.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-[11px]">
                            <span className={cn('w-1.5 h-1.5 rounded-full',
                              f.severity === 'high' ? 'bg-red-400' : f.severity === 'med' ? 'bg-orange-400' : 'bg-yellow-400'
                            )} />
                            <span className="text-[#e8e2f5]">{f.message}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Stats grid */}
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: 'Solde', value: `${new Intl.NumberFormat('fr-FR').format(userDetail.user.coins)} ⚜`, color: '#ffc542' },
                      { label: 'Total misé', value: `${new Intl.NumberFormat('fr-FR').format(userDetail.user.totalWagered)} ⚜`, color: '#e8e2f5' },
                      { label: 'Profit net', value: `${userDetail.stats.netProfit >= 0 ? '+' : ''}${new Intl.NumberFormat('fr-FR').format(userDetail.stats.netProfit)} ⚜`, color: userDetail.stats.netProfit >= 0 ? '#10b981' : '#ef4444' },
                      { label: 'Winrate', value: `${(userDetail.stats.winrate * 100).toFixed(0)}%`, color: userDetail.stats.winrate > 0.75 ? '#ef4444' : '#e8e2f5' },
                    ].map((s, i) => (
                      <div key={i} className="rounded-lg p-3" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                        <p className="text-[9px] text-[#6b6488] uppercase tracking-wider">{s.label}</p>
                        <p className="font-bold text-[14px] mt-1" style={{ color: s.color }}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Paris 24h', value: userDetail.stats.bets24h },
                      { label: 'Paris 7j', value: userDetail.stats.bets7d },
                      { label: 'Total paris', value: userDetail.stats.totalBets },
                    ].map((s, i) => (
                      <div key={i} className="rounded-lg p-2 text-center" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                        <p className="text-[9px] text-[#6b6488] uppercase">{s.label}</p>
                        <p className="font-bold text-[13px] text-[#e8e2f5]">{s.value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Recent bets */}
                  <div>
                    <h3 className="text-[11px] font-bold text-[#6b6488] uppercase mb-2">Derniers paris ({userDetail.recentBets.length})</h3>
                    <div className="rounded-lg overflow-hidden" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                            {['Match', 'Pick', 'Cote', 'Mise', 'Gain', 'Statut', 'Date'].map(h => (
                              <th key={h} className="text-left px-3 py-2 text-[10px] text-[#6b6488] uppercase">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {userDetail.recentBets.slice(0, 20).map(b => {
                            const pick = b.selectedPlayer === 1 ? b.match.player1.name : b.selectedPlayer === 2 ? b.match.player2.name : 'Draw';
                            return (
                              <tr key={b.id} style={{ borderBottom: '1px solid #1e1a3022' }}>
                                <td className="px-3 py-2 text-[#e8e2f5]">{b.match.player1.name} vs {b.match.player2.name}</td>
                                <td className="px-3 py-2 text-[#9990b8]">{pick}</td>
                                <td className="px-3 py-2 text-[#9990b8]">{b.oddsAtBet.toFixed(2)}</td>
                                <td className="px-3 py-2 text-[#ffc542]">{b.amount} ⚜</td>
                                <td className="px-3 py-2" style={{ color: b.status === 'WON' ? '#10b981' : b.status === 'LOST' ? '#ef4444' : '#6b6488' }}>
                                  {b.payout ? `+${b.payout}` : '—'}
                                </td>
                                <td className="px-3 py-2">
                                  <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold',
                                    b.status === 'WON' ? 'text-emerald-400 bg-emerald-950/50' :
                                    b.status === 'LOST' ? 'text-red-400 bg-red-950/50' :
                                    b.status === 'REFUNDED' ? 'text-blue-400 bg-blue-950/50' :
                                    'text-[#6b6488] bg-[#1e1a30]'
                                  )}>{b.status}</span>
                                </td>
                                <td className="px-3 py-2 text-[#6b6488] whitespace-nowrap">{formatDateTime(b.createdAt)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Recent transactions */}
                  {userDetail.recentTransactions.length > 0 && (
                    <div>
                      <h3 className="text-[11px] font-bold text-[#6b6488] uppercase mb-2">Transactions ({userDetail.recentTransactions.length})</h3>
                      <div className="rounded-lg overflow-hidden" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr style={{ borderBottom: '1px solid #1e1a30' }}>
                              {['Type', 'Montant USD', 'Coins', 'Statut', 'Date'].map(h => (
                                <th key={h} className="text-left px-3 py-2 text-[10px] text-[#6b6488] uppercase">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {userDetail.recentTransactions.map(tx => (
                              <tr key={tx.id} style={{ borderBottom: '1px solid #1e1a3022' }}>
                                <td className="px-3 py-2 text-[#e8e2f5] capitalize">{tx.type}</td>
                                <td className="px-3 py-2 text-[#9990b8]">${(tx.amount / 100).toFixed(2)}</td>
                                <td className="px-3 py-2 text-[#ffc542]">{tx.coins > 0 ? '+' : ''}{tx.coins} ⚜</td>
                                <td className="px-3 py-2">
                                  <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-bold',
                                    tx.status === 'completed' ? 'text-emerald-400 bg-emerald-950/50' :
                                    tx.status === 'pending' ? 'text-amber-400 bg-amber-950/50' :
                                    'text-red-400 bg-red-950/50'
                                  )}>{tx.status}</span>
                                </td>
                                <td className="px-3 py-2 text-[#6b6488] whitespace-nowrap">{formatDateTime(tx.createdAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Quick actions */}
                  <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid #1e1a30' }}>
                    <button onClick={() => { handleBan(userDetail.user.id, userDetail.user.isBanned); setUserDetail(null); }}
                      className={cn('px-3 py-1.5 rounded text-[11px] font-medium',
                        userDetail.user.isBanned ? 'bg-emerald-950 border border-emerald-800/40 text-emerald-400' : 'bg-red-950 border border-red-800/40 text-red-400'
                      )}>
                      {userDetail.user.isBanned ? 'Débannir' : 'Bannir'}
                    </button>
                    <button onClick={() => { setAdjustModal({ userId: userDetail.user.id, username: userDetail.user.username }); setUserDetail(null); }}
                      className="px-3 py-1.5 rounded text-[11px] font-medium" style={{ background: '#ffc54215', border: '1px solid #ffc54230', color: '#ffc542' }}>
                      <Coins size={11} className="inline -mt-0.5 mr-1" /> Ajuster coins
                    </button>
                    <button onClick={() => { setMuteModal({ userId: userDetail.user.id, username: userDetail.user.username }); setUserDetail(null); }}
                      className="px-3 py-1.5 rounded text-[11px] font-medium" style={{ background: '#13111f', border: '1px solid #2a2640', color: '#9990b8' }}>
                      <VolumeX size={11} className="inline -mt-0.5 mr-1" /> Muter
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── SCORE MODAL ──────────────────────────────────────────────────── */}
      {scoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setScoreModal(null)}>
          <div className="rounded-xl p-6 max-w-sm w-full" style={{ background: '#0d0b1a', border: '1px solid #10b98140' }} onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[15px] mb-1" style={{ fontFamily: 'Cinzel, serif', color: '#10b981' }}>Score BO en direct</h3>
            <p className="text-[12px] text-[#6b6488] mb-5">{scoreModal.player1Name} vs {scoreModal.player2Name}</p>

            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1">
                <label className="text-[10px] text-amber-400 uppercase tracking-wider font-cinzel block mb-1.5">{scoreModal.player1Name}</label>
                <input
                  type="number" min="0" max="9"
                  value={scoreP1}
                  onChange={e => setScoreP1(e.target.value)}
                  className="w-full text-center text-2xl font-bold font-cinzel h-14 rounded-lg border outline-none"
                  style={{ background: '#07060f', borderColor: '#ffc54240', color: '#ffd97a' }}
                />
              </div>
              <span className="text-[#6b6488] font-cinzel text-xl mt-5">—</span>
              <div className="flex-1">
                <label className="text-[10px] text-blue-400 uppercase tracking-wider font-cinzel block mb-1.5">{scoreModal.player2Name}</label>
                <input
                  type="number" min="0" max="9"
                  value={scoreP2}
                  onChange={e => setScoreP2(e.target.value)}
                  className="w-full text-center text-2xl font-bold font-cinzel h-14 rounded-lg border outline-none"
                  style={{ background: '#07060f', borderColor: '#0891b240', color: '#38bdf8' }}
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setScoreModal(null)} className="flex-1 py-2 rounded-lg text-[12px] text-[#6b6488] border border-[#1e1a30] hover:border-[#2d2850] font-cinzel transition-colors">
                Annuler
              </button>
              <button
                onClick={handleSetScore}
                className="flex-1 py-2 rounded-lg text-[12px] font-bold font-cinzel transition-all"
                style={{ background: '#10b98120', border: '1px solid #10b98150', color: '#10b981' }}
              >
                Mettre à jour
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── INSPECT MODAL ────────────────────────────────────────────────── */}
      {(inspectData || inspectLoading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setInspectData(null)}>
          <div
            className="rounded-xl w-full max-w-3xl overflow-hidden"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30', maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            {inspectLoading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-2 border-[#ffc542] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : inspectData ? (() => {
              const { match: m, betsPlayer1, betsPlayer2, stats } = inspectData;
              const statusColor = m.status === 'LIVE' ? '#10b981' : m.status === 'COMPLETED' ? '#6b6488' : '#ffc542';

              const BetRow = ({ bet, playerName }: { bet: InspectBet; playerName: string }) => {
                const statusColors: Record<string, string> = {
                  WON: '#10b981', LOST: '#ef4444', REFUNDED: '#38bdf8', PENDING: '#9990b8', CANCELLED: '#6b6488',
                };
                return (
                  <tr className="hover:bg-[#13111f] transition-colors" style={{ borderBottom: '1px solid #1e1a3022' }}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {bet.user.avatar
                          ? <Image src={bet.user.avatar} alt="" width={24} height={24} unoptimized className="w-6 h-6 rounded-full object-cover" />
                          : <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ background: '#1e1a30', color: '#ffc542' }}>{bet.user.username[0]?.toUpperCase()}</div>
                        }
                        <span className="text-[12px] font-semibold text-[#e8e2f5]">{bet.user.username}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-[#ffc542] font-bold font-mono">{bet.amount.toFixed(2)} ⚜</td>
                    <td className="px-3 py-2.5 text-[11px] text-[#9990b8] font-mono">×{bet.oddsAtBet.toFixed(2)}</td>
                    <td className="px-3 py-2.5 text-[11px] font-mono text-[#9990b8]">{(bet.amount * bet.oddsAtBet).toFixed(2)} ⚜</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: `${statusColors[bet.status] ?? '#6b6488'}18`, color: statusColors[bet.status] ?? '#6b6488', border: `1px solid ${statusColors[bet.status] ?? '#6b6488'}40` }}>
                        {bet.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-[#6b6488]">{bet.user.coins.toLocaleString('fr-FR')} ⚜</td>
                  </tr>
                );
              };

              return (
                <div>
                  {/* Header */}
                  <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid #1e1a30' }}>
                    <div className="flex items-center gap-3">
                      <Eye size={15} className="text-[#38bdf8]" />
                      <div>
                        <h3 className="font-bold text-[14px] text-[#e8e2f5]" style={{ fontFamily: 'Cinzel, serif' }}>
                          {m.player1.name} <span className="text-[#6b6488]">vs</span> {m.player2.name}
                        </h3>
                        <p className="text-[11px] text-[#6b6488]">{m.tournament?.name} · {m.format}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[11px] font-bold px-2 py-1 rounded" style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}40` }}>
                        {m.status}
                      </span>
                      <button onClick={() => setInspectData(null)} className="text-[#6b6488] hover:text-[#e8e2f5] transition-colors">
                        <XIcon size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="p-5 space-y-5">
                    {/* Match stats */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-lg p-3" style={{ background: '#07060f', border: '1px solid #1e1a30' }}>
                        <p className="text-[10px] text-[#6b6488] uppercase tracking-wider mb-2">Cotes</p>
                        <p className="text-[13px] font-mono font-bold text-[#ffc542]">{m.odds1.toFixed(2)} <span className="text-[#6b6488]">vs</span> {m.odds2.toFixed(2)}</p>
                      </div>
                      <div className="rounded-lg p-3" style={{ background: '#07060f', border: '1px solid #1e1a30' }}>
                        <p className="text-[10px] text-[#6b6488] uppercase tracking-wider mb-2">Score live</p>
                        <p className="text-[13px] font-mono font-bold text-[#e8e2f5]">{m.p1Score ?? 0} – {m.p2Score ?? 0}</p>
                      </div>
                    </div>

                    {/* Volume bar */}
                    <div className="rounded-lg p-4" style={{ background: '#07060f', border: '1px solid #1e1a30' }}>
                      <div className="flex justify-between text-[11px] mb-2">
                        <span className="text-amber-400 font-bold">{m.player1.name} — {stats.volume1.toLocaleString('fr-FR')} ⚜ ({stats.pct1}%)</span>
                        <span className="text-blue-400 font-bold">{stats.pct2}% ({stats.volume2.toLocaleString('fr-FR')} ⚜) — {m.player2.name}</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1e1a30' }}>
                        <div className="h-full rounded-full" style={{ width: `${stats.pct1}%`, background: 'linear-gradient(90deg, #ffc542, #ffd97a)' }} />
                      </div>
                      <div className="flex justify-between text-[10px] mt-1.5 text-[#6b6488]">
                        <span>{stats.count1} pari(s)</span>
                        <span>Total : {stats.total.toLocaleString('fr-FR')} ⚜</span>
                        <span>{stats.count2} pari(s)</span>
                      </div>
                    </div>

                    {/* Bets side by side */}
                    <div className="grid grid-cols-2 gap-4">
                      {/* Player 1 bets */}
                      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,197,66,0.25)' }}>
                        <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(255,197,66,0.08)', borderBottom: '1px solid rgba(255,197,66,0.15)' }}>
                          <TrendingUp size={11} className="text-amber-400" />
                          <span className="text-[11px] font-bold text-amber-400 font-cinzel truncate">{m.player1.name}</span>
                          <span className="ml-auto text-[10px] text-[#6b6488]">{stats.count1}</span>
                        </div>
                        {betsPlayer1.length > 0 ? (
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr style={{ borderBottom: '1px solid #1e1a3044' }}>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Joueur</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Mise</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Cote</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Retour</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Statut</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Solde</th>
                              </tr>
                            </thead>
                            <tbody>
                              {betsPlayer1.map(bet => <BetRow key={bet.id} bet={bet} playerName={m.player1.name} />)}
                            </tbody>
                          </table>
                        ) : (
                          <p className="text-center py-6 text-[11px] text-[#6b6488]">Aucun pari</p>
                        )}
                      </div>

                      {/* Player 2 bets */}
                      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(56,189,248,0.25)' }}>
                        <div className="px-3 py-2 flex items-center gap-2" style={{ background: 'rgba(56,189,248,0.08)', borderBottom: '1px solid rgba(56,189,248,0.15)' }}>
                          <TrendingUp size={11} className="text-blue-400" />
                          <span className="text-[11px] font-bold text-blue-400 font-cinzel truncate">{m.player2.name}</span>
                          <span className="ml-auto text-[10px] text-[#6b6488]">{stats.count2}</span>
                        </div>
                        {betsPlayer2.length > 0 ? (
                          <table className="w-full text-[11px]">
                            <thead>
                              <tr style={{ borderBottom: '1px solid #1e1a3044' }}>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Joueur</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Mise</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Cote</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Retour</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Statut</th>
                                <th className="text-left px-3 py-1.5 text-[10px] text-[#6b6488] font-medium">Solde</th>
                              </tr>
                            </thead>
                            <tbody>
                              {betsPlayer2.map(bet => <BetRow key={bet.id} bet={bet} playerName={m.player2.name} />)}
                            </tbody>
                          </table>
                        ) : (
                          <p className="text-center py-6 text-[11px] text-[#6b6488]">Aucun pari</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })() : null}
          </div>
        </div>
      )}

      {/* ── LP DEBUG MODAL ───────────────────────────────────────────────── */}
      {lpDebug && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4" onClick={() => setLpDebug(null)}>
          <div
            className="rounded-xl w-full max-w-2xl overflow-hidden"
            style={{ background: '#0d0b1a', border: '1px solid #7c3aed40', maxHeight: '85vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e1a30]">
              <h3 className="font-bold text-[14px] text-[#a78bfa]" style={{ fontFamily: 'Cinzel, serif' }}>LP Debug</h3>
              <button onClick={() => setLpDebug(null)} className="text-[#6b6488] hover:text-white text-xl">×</button>
            </div>
            <div className="p-5 space-y-3">
              {/* Diagnosis banner */}
              <div className={`rounded-lg px-4 py-3 text-[13px] font-semibold ${
                String(lpDebug.diagnosis ?? '').startsWith('Found')
                  ? 'bg-green-900/30 border border-green-600/40 text-green-300'
                  : 'bg-red-900/30 border border-red-600/40 text-red-300'
              }`}>
                {String(lpDebug.diagnosis ?? lpDebug.error ?? 'Unknown')}
              </div>

              {/* Key info */}
              <div className="grid grid-cols-2 gap-2 text-[12px]">
                {([
                  ['Page LP', lpDebug.page],
                  ['Score DB', lpDebug.dbScore],
                  ['Statut DB', lpDebug.dbStatus],
                  ['Matchs LP trouvés', lpDebug.lpMatchesFound],
                ] as [string, unknown][]).map(([label, value]) => value !== undefined && (
                  <div key={label} className="rounded p-2" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                    <div className="text-[#6b6488] text-[10px] uppercase tracking-wider">{label}</div>
                    <div className="text-[#e8e2f5] mt-0.5 font-mono">{String(value ?? '—')}</div>
                  </div>
                ))}
              </div>

              {/* All opponent pairs */}
              {Array.isArray(lpDebug.allOpponentPairs) && lpDebug.allOpponentPairs.length > 0 && (
                <div>
                  <div className="text-[11px] text-[#6b6488] uppercase tracking-wider mb-2">Tous les matchs sur la page LP</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {(lpDebug.allOpponentPairs as Array<{ opp1: string; opp2: string; score: string; bestof: number }>).map((pair, i) => (
                      <div key={i} className="flex items-center justify-between rounded px-3 py-2 text-[12px]" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                        <span className="text-[#e8e2f5]">{pair.opp1} <span className="text-[#6b6488]">vs</span> {pair.opp2}</span>
                        <span className="text-[#ffc542] font-mono">{pair.score} <span className="text-[#6b6488]">BO{pair.bestof}</span></span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Matched block detail */}
              {lpDebug.matchedBlock && (
                <div>
                  <div className="text-[11px] text-[#6b6488] uppercase tracking-wider mb-2">Bloc matché</div>
                  <pre className="text-[11px] text-[#a78bfa] rounded p-3 overflow-x-auto" style={{ background: '#13111f', border: '1px solid #7c3aed30' }}>
                    {JSON.stringify(lpDebug.matchedBlock, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── RESULT MODAL ─────────────────────────────────────────────────── */}
      {resultModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="rounded-xl p-6 max-w-md w-full" style={{ background: '#0d0b1a', border: '1px solid #ffc54240' }}>
            <h3 className="font-bold text-[16px] text-[#ffc542] mb-1" style={{ fontFamily: 'Cinzel, serif' }}>Définir le résultat</h3>
            <p className="text-[12px] text-[#6b6488] mb-5">{resultModal.player1Name} vs {resultModal.player2Name}</p>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] text-[#6b6488] uppercase tracking-wider mb-2 block">Gagnant</label>
                <div className="grid grid-cols-2 gap-2">
                  {[{ id: resultModal.player1Id, name: resultModal.player1Name }, { id: resultModal.player2Id, name: resultModal.player2Name }].map(p => (
                    <button
                      key={p.id}
                      onClick={() => setResultForm(f => ({ ...f, winnerId: p.id }))}
                      className="p-3 rounded-lg text-[13px] font-semibold transition-all"
                      style={{
                        border: `1px solid ${resultForm.winnerId === p.id ? '#ffc542' : '#1e1a30'}`,
                        background: resultForm.winnerId === p.id ? '#ffc54220' : '#13111f',
                        color: resultForm.winnerId === p.id ? '#ffc542' : '#9990b8',
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-[11px] text-[#6b6488] uppercase tracking-wider mb-2 block">Score (ex: 2-1)</label>
                <input
                  type="text"
                  value={resultForm.score}
                  onChange={e => setResultForm(f => ({ ...f, score: e.target.value }))}
                  placeholder="2-1"
                  className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none text-[#e8e2f5]"
                  style={{ background: '#13111f', border: '1px solid #1e1a30' }}
                />
              </div>
            </div>

            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setResultModal(null); setResultForm({ winnerId: '', score: '' }); }}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-medium text-[#9990b8] transition-all hover:text-[#e8e2f5]"
                style={{ background: '#13111f', border: '1px solid #1e1a30' }}
              >
                Annuler
              </button>
              <button
                onClick={handleSetResult}
                disabled={!resultForm.winnerId || !resultForm.score || submitting}
                className="flex-1 py-2.5 rounded-lg text-[13px] font-bold transition-all disabled:opacity-40"
                style={{ background: '#ffc542', color: '#07060f' }}
              >
                {submitting ? <RefreshCw size={14} className="animate-spin mx-auto" /> : 'Confirmer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MUTE MODAL ───────────────────────────────────────────────────── */}
      {muteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="rounded-xl p-6 max-w-sm w-full" style={{ background: '#0d0b1a', border: '1px solid #3b82f640' }}>
            <h3 className="font-bold text-[15px] mb-1 flex items-center gap-2" style={{ color: '#60a5fa' }}>
              <VolumeX size={16} /> Muter {muteModal.username}
            </h3>
            <p className="text-[12px] text-[#6b6488] mb-4">Sélectionne la durée du mute</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[5, 15, 60, 360, 1440, 10080].map(min => (
                <button key={min} onClick={() => setMuteDuration(min)}
                  className="py-2 rounded-lg text-[11px] font-bold transition-all"
                  style={{
                    background: muteDuration === min ? '#1e3a5f' : '#13111f',
                    border: `1px solid ${muteDuration === min ? '#3b82f6' : '#1e1a30'}`,
                    color: muteDuration === min ? '#60a5fa' : '#6b6488',
                  }}>
                  {min < 60 ? `${min} min` : min < 1440 ? `${min/60}h` : min === 1440 ? '24h' : '7j'}
                </button>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setMuteModal(null)} className="flex-1 py-2 rounded-lg text-[12px] text-[#9990b8]" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>Annuler</button>
              <button onClick={handleMute} className="flex-1 py-2 rounded-lg text-[12px] font-bold" style={{ background: '#3b82f6', color: '#fff' }}>Muter</button>
            </div>
          </div>
        </div>
      )}

      {/* ── ADJUST COINS MODAL ───────────────────────────────────────────── */}
      {adjustModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="rounded-xl p-6 max-w-sm w-full" style={{ background: '#0d0b1a', border: '1px solid #ffc54240' }}>
            <h3 className="font-bold text-[15px] text-[#ffc542] mb-1">Ajuster les coins</h3>
            <p className="text-[12px] text-[#6b6488] mb-4">{adjustModal.username}</p>
            <input
              type="number"
              value={adjustAmount}
              onChange={e => setAdjustAmount(e.target.value)}
              placeholder="Montant (négatif pour débiter)"
              className="w-full px-3 py-2.5 rounded-lg text-[13px] outline-none text-[#e8e2f5] mb-4"
              style={{ background: '#13111f', border: '1px solid #1e1a30' }}
            />
            <div className="flex gap-3">
              <button onClick={() => setAdjustModal(null)} className="flex-1 py-2 rounded-lg text-[12px] text-[#9990b8]" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>Annuler</button>
              <button onClick={handleAdjustCoins} className="flex-1 py-2 rounded-lg text-[12px] font-bold" style={{ background: '#ffc542', color: '#07060f' }}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScrapersPanel({ showMsg }: { showMsg: (type: 'success' | 'error', text: string) => void }) {
  const [logs, setLogs] = useState<{ id: string; source: string; status: string; matchesFound: number; duration: number | null; error: string | null; createdAt: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState<string | null>(null);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await getScraperLogs({ limit: 30 });
      setLogs(res.data as typeof logs);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLogs(); const i = setInterval(fetchLogs, 30000); return () => clearInterval(i); }, [fetchLogs]);

  const trigger = async (source: string) => {
    setTriggering(source);
    try {
      await triggerScraper(source as 'tournaments' | 'aoe4world');
      showMsg('success', `Scraper ${source} déclenché`);
      setTimeout(fetchLogs, 2000);
    } catch (err) {
      showMsg('error', err instanceof Error ? err.message : 'Erreur');
    } finally {
      setTriggering(null);
    }
  };

  const scrapers = [
    { id: 'liquipedia', label: 'Matchs Liquipedia', desc: 'Scrape les 4 wikis AoE pour les matchs à venir' },
    { id: 'tournaments', label: 'Tournois aoe4world', desc: 'Fetch matchs à venir depuis aoe4world API' },
    { id: 'enrich', label: 'Enrichir cotes', desc: 'Recalculer H2H + cotes de tous les matchs' },
    { id: 'aoe4world', label: 'Stats joueurs', desc: 'MAJ winrate + historique tournoi via aoe4world' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {scrapers.map(s => {
          const last = logs.find(l => l.source === s.id);
          return (
            <div key={s.id} className="rounded-lg p-4" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="font-semibold text-[13px] text-[#e8e2f5]">{s.label}</p>
                  <p className="text-[11px] text-[#6b6488] mt-0.5">{s.desc}</p>
                </div>
                <button
                  onClick={() => trigger(s.id)}
                  disabled={triggering === s.id}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-[11px] font-medium transition-all disabled:opacity-50 shrink-0 ml-2"
                  style={{ background: '#ffc54220', border: '1px solid #ffc54240', color: '#ffc542' }}
                >
                  {triggering === s.id ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />}
                  Lancer
                </button>
              </div>
              {last && (
                <div className="flex items-center gap-2 text-[11px] mt-3 pt-3" style={{ borderTop: '1px solid #1e1a30' }}>
                  {last.status === 'success' ? <CheckCircle size={12} className="text-emerald-400" /> : <AlertTriangle size={12} className="text-amber-400" />}
                  <span className={last.status === 'success' ? 'text-emerald-400' : 'text-amber-400'}>
                    {last.matchesFound} matchs · {last.duration ? `${(last.duration / 1000).toFixed(1)}s` : '?'}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #1e1a30', background: '#0d0b1a' }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
          <span className="text-[13px] font-semibold text-[#ffc542]">JOURNAUX</span>
          <button onClick={fetchLogs} className="text-[#6b6488] hover:text-[#e8e2f5]">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ borderBottom: '1px solid #1e1a30' }}>
              {['Source', 'Statut', 'Matchs', 'Durée', 'Date', 'Erreur'].map(h => (
                <th key={h} className="text-left px-4 py-2 text-[11px] text-[#6b6488] uppercase tracking-wider font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="hover:bg-[#13111f]" style={{ borderBottom: '1px solid #1e1a3022' }}>
                <td className="px-4 py-2 font-semibold text-[#e8e2f5]">{log.source}</td>
                <td className="px-4 py-2">
                  <span className={log.status === 'success' ? 'text-emerald-400' : log.status === 'error' ? 'text-red-400' : 'text-amber-400'}>
                    {log.status === 'success' ? '✓' : log.status === 'error' ? '✗' : '~'} {log.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-[#9990b8]">{log.matchesFound}</td>
                <td className="px-4 py-2 text-[#9990b8]">{log.duration ? `${(log.duration / 1000).toFixed(1)}s` : ''}</td>
                <td className="px-4 py-2 text-[#6b6488]">{new Date(log.createdAt).toLocaleTimeString('fr-FR')}</td>
                <td className="px-4 py-2 text-red-400 truncate max-w-[200px]">{log.error ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
