'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { apiClient, setAuthToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  Copy, Check, Users, TrendingUp, Coins, UserCheck, Rocket,
} from 'lucide-react';

interface Referral {
  id: string;
  referredUserId: string;
  totalDeposited: number;
  totalWagered: number;
  commission: number;
  isActive: boolean;
  joinedAt: string;
  lastActiveAt: string | null;
  user: { id: string; username: string; avatar: string | null; createdAt: string } | null;
}

interface AffiliateData {
  code: string;
  commissionRate: number;
  totalEarnings: number;
  available: number;
  createdAt?: string;
  codeUnlocksAt?: string;
  totalReferrals: number;
  activeReferrals: number;
  totalDeposited: number;
  referrals: Referral[];
}

type TabType = 'dashboard' | 'tiers';

// 3-tier progressive revshare on net losses
const TIERS = [
  { level: 'Bronze', rate: 0.25, refs:  0,  color: '#cd7f32', desc: 'Par défaut — dès ton premier code' },
  { level: 'Silver', rate: 0.30, refs: 10,  color: '#c0c0c0', desc: '10 filleuls actifs + 10 000⚜ déposés' },
  { level: 'Gold',   rate: 0.35, refs: 50,  color: '#d4a017', desc: '50 filleuls actifs + 50 000⚜ déposés' },
];

function EarningsChart({ data }: { data: number[] }) {
  if (data.length < 2 || data.every(v => v === 0)) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[12px]" style={{ color: '#3d3860' }}>Pas encore de données</p>
      </div>
    );
  }
  const max = Math.max(...data, 1);
  const W = 600, H = 100;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (v / max) * H * 0.9;
    return `${x},${y}`;
  });
  const polyline = pts.join(' ');
  const area = `${pts[0].split(',')[0]},${H} ${polyline} ${pts[pts.length - 1].split(',')[0]},${H}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id="aff-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#d4a017" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#d4a017" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#aff-grad)" />
      <polyline points={polyline} fill="none" stroke="#d4a017" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function AffiliatePage() {
  const { data: session, status } = useSession();

  const [aff, setAff] = useState<AffiliateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('tiers');
  const [referralFilter, setReferralFilter] = useState<'all' | 'active'>('all');
  const [claimMsg, setClaimMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [createErr, setCreateErr] = useState<string | null>(null);
  const [editingCode, setEditingCode] = useState(false);
  const [newCodeInput, setNewCodeInput] = useState('');
  const [changeErr, setChangeErr] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);

  useEffect(() => {
    if (session?.user.accessToken) setAuthToken(session.user.accessToken);
  }, [session]);

  const fetchAff = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiClient.get('/affiliate/me');
      setAff(res.data.data);
    } catch { /* no code yet */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (session) fetchAff(); }, [session, fetchAff]);

  // Default to Dashboard once logged in; keep Tiers for logged-out visitors
  useEffect(() => {
    if (session) setActiveTab('dashboard');
  }, [session]);

  async function createCode() {
    setCreateErr(null);
    const trimmed = customCode.trim();
    if (!trimmed) {
      setCreateErr('Choisis un code');
      return;
    }
    if (!/^[A-Za-z0-9]{3,16}$/.test(trimmed)) {
      setCreateErr('3 à 16 caractères alphanumériques');
      return;
    }
    setCreating(true);
    try {
      const res = await apiClient.post('/affiliate/me/create', { customCode: trimmed });
      setAff(res.data.data);
      await fetchAff();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erreur lors de la création du code';
      setCreateErr(msg);
    } finally {
      setCreating(false);
    }
  }

  async function changeCode() {
    setChangeErr(null);
    const trimmed = newCodeInput.trim();
    if (!/^[A-Za-z0-9]{3,16}$/.test(trimmed)) {
      setChangeErr('3 à 16 caractères alphanumériques');
      return;
    }
    setChanging(true);
    try {
      const res = await apiClient.patch('/affiliate/me/code', { customCode: trimmed });
      setAff(res.data.data);
      setEditingCode(false);
      setNewCodeInput('');
      await fetchAff();
    } catch (e) {
      setChangeErr(e instanceof Error ? e.message : 'Erreur');
    } finally {
      setChanging(false);
    }
  }

  async function claim() {
    setClaiming(true);
    try {
      const res = await apiClient.post('/affiliate/claim', {});
      setClaimMsg({ type: 'ok', text: `+${res.data.claimed.toLocaleString('fr-FR')}⚜ crédités` });
      fetchAff();
    } catch (e) {
      setClaimMsg({ type: 'err', text: e instanceof Error ? e.message : 'Erreur' });
    } finally {
      setClaiming(false);
      setTimeout(() => setClaimMsg(null), 4000);
    }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  // Current tier
  const currentTier = useMemo(() => {
    if (!aff) return TIERS[0];
    const rate = aff.commissionRate;
    return [...TIERS].reverse().find(t => t.rate <= rate + 1e-9) ?? TIERS[0];
  }, [aff]);

  // Chart data (7 days)
  const chartData = useMemo(() => {
    return [0, 0, 0, 0, 0, 0, 0].map((_, i) => {
      const now = Date.now();
      const dayStart = now - (6 - i) * 86400000;
      const dayEnd = dayStart + 86400000;
      return (aff?.referrals ?? []).reduce((s, r) => {
        const t = new Date(r.joinedAt).getTime();
        return t >= dayStart && t < dayEnd ? s + r.commission : s;
      }, 0);
    });
  }, [aff]);

  const filteredReferrals = (aff?.referrals ?? []).filter(r => referralFilter === 'all' || r.isActive);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="w-8 h-8 border-2 border-[#d4a017] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">

        {/* ── Hero ── */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 80% 50%, rgba(212,160,23,0.1) 0%, transparent 70%)' }} />
          <div className="absolute right-0 top-0 bottom-0 w-64 opacity-10"
            style={{ background: 'repeating-linear-gradient(45deg, #d4a017 0px, #d4a017 1px, transparent 0px, transparent 50%)' }} />

          <div className="relative px-6 md:px-8 py-8">
            <div className="flex items-start gap-2 mb-3">
              <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest"
                style={{ background: '#d4a01722', color: '#d4a017', border: '1px solid #d4a01755' }}>
                Programme affiliés
              </span>
              <span className="text-[10px] font-bold px-2 py-1 rounded-full uppercase tracking-widest"
                style={{ background: '#22c55e22', color: '#22c55e', border: '1px solid #22c55e55' }}>
                Revshare à vie
              </span>
            </div>
            <h1 className="text-2xl md:text-3xl font-black leading-tight mb-3"
              style={{ fontFamily: 'Cinzel,serif', color: '#e8e2f5' }}>
              Gagne <span style={{ color: '#d4a017' }}>jusqu&apos;à 35%</span> des pertes<br />
              de chaque joueur que tu ramènes
            </h1>
            <p className="text-[13px] leading-relaxed mb-5 max-w-xl" style={{ color: '#8a82a8' }}>
              Le meilleur deal affilié de l&apos;esport AoE. 25% de base, 30% à 10 filleuls, 35% à 50.
              Pas de plafond, pas de limite de temps. Tant que ton filleul joue, tu gagnes.
            </p>

            {!session ? (
              <div className="text-[12px]" style={{ color: '#6b6488' }}>
                Connecte-toi avec Steam pour générer ton code en 1 clic.
              </div>
            ) : !aff ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <input
                  type="text"
                  value={customCode}
                  onChange={e => setCustomCode(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 16))}
                  placeholder="Choisis ton code (3-16 car.)"
                  maxLength={16}
                  className="px-4 py-2.5 rounded-lg text-[13px] font-mono tracking-widest w-full sm:w-60 outline-none"
                  style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e8e2f5' }}
                />
                <button
                  onClick={createCode}
                  disabled={creating || !customCode.trim()}
                  className="inline-flex items-center gap-2 px-6 py-2.5 rounded-lg font-bold text-[13px] transition-opacity hover:opacity-80 disabled:opacity-40 w-full sm:w-auto justify-center"
                  style={{ background: '#d4a017', color: '#07060f' }}>
                  <Rocket size={14} />
                  {creating ? 'Création...' : 'Créer mon code'}
                </button>
              </div>
            ) : editingCode ? (
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <input
                  type="text"
                  value={newCodeInput}
                  onChange={e => setNewCodeInput(e.target.value.replace(/[^A-Za-z0-9]/g, '').slice(0, 16))}
                  placeholder="Nouveau code"
                  maxLength={16}
                  className="px-4 py-2.5 rounded-lg text-[13px] font-mono tracking-widest w-full sm:w-60 outline-none"
                  style={{ background: '#13111f', border: '1px solid #2a2640', color: '#e8e2f5' }}
                />
                <button onClick={changeCode} disabled={changing || !newCodeInput.trim()}
                  className="px-5 py-2.5 rounded-lg font-bold text-[13px] disabled:opacity-40"
                  style={{ background: '#d4a017', color: '#07060f' }}>
                  {changing ? '...' : 'Confirmer'}
                </button>
                <button onClick={() => { setEditingCode(false); setNewCodeInput(''); setChangeErr(null); }}
                  className="px-4 py-2.5 rounded-lg text-[12px]"
                  style={{ background: 'transparent', border: '1px solid #2a2640', color: '#8a82a8' }}>
                  Annuler
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
                  style={{ background: '#13111f', border: '1px solid #2a2640' }}>
                  <span className="text-[11px] uppercase tracking-widest" style={{ color: '#6b6488' }}>Code</span>
                  <span className="text-[14px] font-mono font-bold tracking-widest" style={{ color: '#d4a017' }}>
                    {aff.code}
                  </span>
                  <button onClick={() => copyText(aff.code, 'code')} className="hover:opacity-70">
                    {copied === 'code' ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} style={{ color: '#6b6488' }} />}
                  </button>
                </div>
                <div className="px-3 py-2 rounded-lg" style={{ background: `${currentTier.color}15`, border: `1px solid ${currentTier.color}55` }}>
                  <span className="text-[11px] font-bold" style={{ color: currentTier.color }}>
                    {currentTier.level} · {Math.round(currentTier.rate * 100)}%
                  </span>
                </div>
                {(() => {
                  const unlocksAt = aff.codeUnlocksAt ? new Date(aff.codeUnlocksAt) : null;
                  const unlocked = unlocksAt ? Date.now() >= unlocksAt.getTime() : true;
                  if (unlocked) {
                    return (
                      <button onClick={() => setEditingCode(true)}
                        className="text-[11px] px-3 py-2 rounded-lg hover:opacity-80"
                        style={{ background: 'transparent', border: '1px solid #2a2640', color: '#8a82a8' }}>
                        Modifier le code
                      </button>
                    );
                  }
                  const daysLeft = Math.ceil((unlocksAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
                  return (
                    <span className="text-[11px] px-3 py-2 rounded-lg" style={{ background: '#13111f', color: '#6b6488', border: '1px solid #1a1730' }}>
                      🔒 modifiable dans {daysLeft}j
                    </span>
                  );
                })()}
              </div>
            )}

            {createErr && !aff && (
              <p className="text-[11px] text-red-400 mt-3">{createErr}</p>
            )}
            {changeErr && editingCode && (
              <p className="text-[11px] text-red-400 mt-3">{changeErr}</p>
            )}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          {(session
            ? [['dashboard', 'Dashboard'], ['tiers', 'Tiers']]
            : [['tiers', 'Tiers']]
          ).map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id as TabType)}
              className="px-4 md:px-5 py-2 rounded-lg text-[12px] font-medium transition-all"
              style={{
                background: activeTab === id ? '#1a1630' : 'transparent',
                color: activeTab === id ? '#e8e2f5' : '#6b6488',
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── DASHBOARD ── */}
        {activeTab === 'dashboard' && (
          <>
            {aff && (
              <>
                {/* Chart + Stats */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  <div className="lg:col-span-2 rounded-xl p-5" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[11px] uppercase tracking-widest" style={{ color: '#6b6488' }}>Commissions gagnées</p>
                      <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: '#1a1630', color: '#6b6488' }}>7 jours</span>
                    </div>
                    <p className="text-2xl font-bold mb-5" style={{ color: '#d4a017', fontFamily: 'Cinzel,serif' }}>
                      ⚜ {aff.totalEarnings.toLocaleString('fr-FR')}
                    </p>
                    <div style={{ height: 100 }}>
                      <EarningsChart data={chartData} />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <Coins size={14} style={{ color: '#d4a017' }} />
                          <span className="text-[18px] font-bold" style={{ color: '#d4a017' }}>
                            {aff.available.toLocaleString('fr-FR')}
                          </span>
                        </div>
                        <button onClick={claim} disabled={claiming || aff.available === 0}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-bold disabled:opacity-40"
                          style={{ background: '#d4a017', color: '#07060f' }}>
                          {claiming ? '...' : 'Réclamer'}
                        </button>
                      </div>
                      <p className="text-[11px]" style={{ color: '#6b6488' }}>Disponible</p>
                      {claimMsg && (
                        <p className={cn('text-[11px] mt-2', claimMsg.type === 'ok' ? 'text-emerald-400' : 'text-red-400')}>
                          {claimMsg.text}
                        </p>
                      )}
                    </div>

                    <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <TrendingUp size={14} style={{ color: '#6b6488' }} />
                        <span className="text-[18px] font-bold" style={{ color: '#e8e2f5' }}>
                          {aff.totalEarnings.toLocaleString('fr-FR')}
                        </span>
                      </div>
                      <p className="text-[11px]" style={{ color: '#6b6488' }}>Total gagné</p>
                    </div>

                    <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Users size={14} style={{ color: '#6b6488' }} />
                        <span className="text-[18px] font-bold" style={{ color: '#e8e2f5' }}>
                          {aff.totalReferrals}
                        </span>
                      </div>
                      <p className="text-[11px]" style={{ color: '#6b6488' }}>Filleuls total</p>
                    </div>

                    <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                      <div className="flex items-center gap-2 mb-1">
                        <UserCheck size={14} style={{ color: '#6b6488' }} />
                        <span className="text-[18px] font-bold" style={{ color: '#e8e2f5' }}>
                          {aff.activeReferrals}
                        </span>
                      </div>
                      <p className="text-[11px]" style={{ color: '#6b6488' }}>Filleuls actifs</p>
                    </div>
                  </div>
                </div>

                {/* Referrals table */}
                <div className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                  <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
                    <h3 className="text-[12px] font-bold uppercase tracking-wider" style={{ color: '#e8e2f5' }}>Filleuls</h3>
                    <div className="flex items-center gap-1">
                      {(['all', 'active'] as const).map(f => (
                        <button key={f} onClick={() => setReferralFilter(f)}
                          className="px-3 py-1.5 rounded-lg text-[11px] font-medium"
                          style={{
                            background: referralFilter === f ? '#1a1630' : 'transparent',
                            color: referralFilter === f ? '#e8e2f5' : '#6b6488',
                            border: `1px solid ${referralFilter === f ? '#2a2640' : 'transparent'}`,
                          }}>
                          {f === 'all' ? 'Tous' : 'Actifs'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredReferrals.length === 0 ? (
                    <div className="text-center py-12">
                      <Users size={24} className="mx-auto mb-3" style={{ color: '#3d3860' }} />
                      <p className="text-[13px]" style={{ color: '#6b6488' }}>Aucun filleul pour le moment</p>
                      <p className="text-[11px] mt-1" style={{ color: '#4a4468' }}>
                        Partage ton code <span style={{ color: '#d4a017' }}>{aff.code}</span> pour commencer à gagner
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y" style={{ borderColor: '#1a1730' }}>
                      {filteredReferrals.map(r => (
                        <div key={r.id} className="grid grid-cols-5 items-center px-5 py-3 hover:bg-[#13111f]">
                          <div className="col-span-2 flex items-center gap-2">
                            {r.user?.avatar
                              ? <img src={r.user.avatar} alt="" className="w-7 h-7 rounded-full" />
                              : <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
                                  style={{ background: '#1a1630', color: '#6b6488' }}>
                                  {(r.user?.username ?? '?')[0]?.toUpperCase()}
                                </div>}
                            <span className="text-[12px] truncate" style={{ color: '#c8c0e0' }}>
                              {r.user?.username ?? r.referredUserId.slice(0, 8)}
                            </span>
                          </div>
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full w-fit"
                            style={{
                              background: r.isActive ? '#04200f' : '#13111f',
                              color: r.isActive ? '#22c55e' : '#4a4468',
                              border: `1px solid ${r.isActive ? '#22c55e33' : '#2a2640'}`,
                            }}>
                            {r.isActive ? 'Actif' : 'Inactif'}
                          </span>
                          <span className="text-[12px]" style={{ color: '#e8e2f5' }}>
                            {r.totalDeposited.toLocaleString('fr-FR')}⚜
                          </span>
                          <span className="text-[12px] font-bold" style={{ color: '#d4a017' }}>
                            {r.commission.toLocaleString('fr-FR')}⚜
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* How it works — visible when no code yet */}
            {!aff && session && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {[
                  { n: '01', t: 'Génère ton code', d: 'Un clic. Choisis un code custom ou laisse-nous en générer un.' },
                  { n: '02', t: 'Partage-le', d: 'Stream, Discord, Twitter, Reddit, TikTok... à toi de jouer.' },
                  { n: '03', t: 'Encaisse', d: 'Commission créditée en temps réel à chaque pari résolu.' },
                ].map(step => (
                  <div key={step.n} className="p-5 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                    <span className="text-[32px] font-black" style={{ color: '#1a1630', fontFamily: 'Cinzel,serif' }}>{step.n}</span>
                    <h3 className="font-bold text-[14px] mt-1 mb-2" style={{ color: '#e8e2f5' }}>{step.t}</h3>
                    <p className="text-[12px]" style={{ color: '#8a82a8' }}>{step.d}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── TIERS ── */}
        {activeTab === 'tiers' && (
          <div className="space-y-3">
            <p className="text-[12px]" style={{ color: '#8a82a8' }}>
              Tu gagnes <span className="font-bold" style={{ color: '#e8e2f5' }}>X% des pertes nettes</span> de
              chaque filleul (pas des dépôts). Plus tu en ramènes, plus ton taux monte — et c&apos;est à vie.
            </p>
            {TIERS.map((tier) => {
              const isCurrent = aff ? Math.abs(aff.commissionRate - tier.rate) < 1e-9 : tier.rate === TIERS[0].rate;
              return (
                <div key={tier.level}
                  className="rounded-xl p-5"
                  style={{
                    background: '#0d0b1a',
                    border: `1px solid ${isCurrent ? tier.color : '#1e1a30'}`,
                    boxShadow: isCurrent ? `0 0 20px ${tier.color}22` : 'none',
                  }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-xl flex items-center justify-center font-bold text-[14px] uppercase"
                        style={{ background: `${tier.color}20`, border: `2px solid ${tier.color}60`, color: tier.color, fontFamily: 'Cinzel,serif' }}>
                        {tier.level.slice(0, 2)}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-[16px]" style={{ fontFamily: 'Cinzel,serif', color: tier.color }}>
                            {tier.level}
                          </p>
                          {isCurrent && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: `${tier.color}30`, color: tier.color, border: `1px solid ${tier.color}60` }}>
                              ACTUEL
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] mt-0.5" style={{ color: '#8a82a8' }}>{tier.desc}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[28px] md:text-[32px] font-black" style={{ color: tier.color, fontFamily: 'Cinzel,serif' }}>
                        {Math.round(tier.rate * 100)}%
                      </p>
                      <p className="text-[10px]" style={{ color: '#4a4468' }}>des pertes nettes</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </div>
  );
}
