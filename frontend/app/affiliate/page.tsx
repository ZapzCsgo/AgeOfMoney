'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { apiClient, setAuthToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Copy, Check, Users, TrendingUp, Coins, UserCheck, Gift } from 'lucide-react';
import { useT } from '@/lib/i18n';

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
  totalReferrals: number;
  activeReferrals: number;
  totalDeposited: number;
  referrals: Referral[];
}

type TabType = 'dashboard' | 'tiers';

// Simple inline SVG line chart
function EarningsChart({ data, noDataLabel }: { data: number[]; noDataLabel: string }) {
  if (data.length < 2) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[12px]" style={{ color: '#3d3860' }}>{noDataLabel}</p>
      </div>
    );
  }
  const max = Math.max(...data, 1);
  const W = 600; const H = 100;
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
          <stop offset="0%" stopColor="#d4a017" stopOpacity="0.3"/>
          <stop offset="100%" stopColor="#d4a017" stopOpacity="0"/>
        </linearGradient>
      </defs>
      <polygon points={area} fill="url(#aff-grad)" />
      <polyline points={polyline} fill="none" stroke="#d4a017" strokeWidth="1.5" strokeLinejoin="round"/>
    </svg>
  );
}

export default function AffiliatePage() {
  const { data: session, status } = useSession();
  const { t } = useT();

  const TIERS = [
    { level: 1,  name: 'Tier 1',  referrals: 0,   activeReferrals: 3,  deposited: 0,          commission: '0.5%', color: '#78716c' },
    { level: 2,  name: 'Tier 2',  referrals: 15,  activeReferrals: 4,  deposited: 15000,      commission: '1%',   color: '#94a3b8' },
    { level: 3,  name: 'Tier 3',  referrals: 15,  activeReferrals: 5,  deposited: 30000,      commission: '1.5%', color: '#d4a017' },
    { level: 4,  name: 'Tier 4',  referrals: 15,  activeReferrals: 6,  deposited: 60000,      commission: '2%',   color: '#f5c842' },
    { level: 5,  name: 'Tier 5',  referrals: 20,  activeReferrals: 7,  deposited: 150000,     commission: '2.5%', color: '#34d399' },
    { level: 6,  name: 'Tier 6',  referrals: 40,  activeReferrals: 10, deposited: 625000,     commission: '3%',   color: '#60a5fa' },
    { level: 7,  name: 'Tier 7',  referrals: 80,  activeReferrals: 20, deposited: 1250000,    commission: '3.5%', color: '#818cf8' },
    { level: 8,  name: 'Tier 8',  referrals: 150, activeReferrals: 30, deposited: 2500000,    commission: '4%',   color: '#c084fc' },
    { level: 9,  name: 'Tier 9',  referrals: 250, activeReferrals: 50, deposited: 5000000,    commission: '4.5%', color: '#f472b6' },
    { level: 10, name: 'Tier 10', referrals: 500, activeReferrals: 100,deposited: 10000000,   commission: '5%',   color: '#fbbf24' },
  ];
  const [aff, setAff] = useState<AffiliateData | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('dashboard');
  const [referralFilter, setReferralFilter] = useState<'all' | 'active'>('all');
  const [claimMsg, setClaimMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

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

  async function claim() {
    setClaiming(true);
    try {
      const res = await apiClient.post('/affiliate/claim', {});
      setClaimMsg({ type: 'ok', text: t('aff_claimed', { n: res.data.claimed.toLocaleString('fr-FR') }) });
      fetchAff();
    } catch (e) {
      setClaimMsg({ type: 'err', text: e instanceof Error ? e.message : t('common_error') });
    } finally {
      setClaiming(false);
      setTimeout(() => setClaimMsg(null), 4000);
    }
  }

  function copyCode() {
    if (!aff) return;
    navigator.clipboard.writeText(aff.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Compute current tier
  const totalReferrals = aff?.totalReferrals ?? 0;
  const totalDeposited = aff?.totalEarnings ?? 0;
  const currentTier = [...TIERS].reverse().find(tier =>
    totalReferrals >= tier.referrals && totalDeposited >= tier.deposited
  ) ?? TIERS[0];

  // Dummy weekly earnings data (last 7 days)
  const chartData = [0, 0, 0, 0, 0, 0, 0].map((_, i) => {
    const now = Date.now();
    const dayStart = now - (6 - i) * 86400000;
    const dayEnd = dayStart + 86400000;
    return (aff?.referrals ?? []).reduce((s, r) => {
      const t = new Date(r.joinedAt).getTime();
      return t >= dayStart && t < dayEnd ? s + r.commission : s;
    }, 0);
  });

  const filteredReferrals = (aff?.referrals ?? []).filter(r => referralFilter === 'all' || r.isActive);

  if (status === 'loading' || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="w-8 h-8 border-2 border-[#d4a017] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="text-center p-8 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          <Gift size={32} className="mx-auto mb-3" style={{ color: '#d4a017' }} />
          <h2 className="font-bold text-lg mb-2" style={{ fontFamily: 'Cinzel,serif', color: '#d4a017' }}>{t('aff_programme')}</h2>
          <p className="text-sm mb-5" style={{ color: '#6b6488' }}>{t('aff_connect_desc')}</p>
          <button onClick={() => signIn()} className="px-6 py-2.5 rounded-lg text-sm font-bold text-[#07060f]"
            style={{ background: '#d4a017' }}>
            {t('auth_signin_steam')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: '#07060f', color: '#e8e2f5' }}>
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-5">

        {/* ── Hero banner ── */}
        <div className="relative rounded-2xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30', minHeight: 160 }}>
          {/* Background decoration */}
          <div className="absolute inset-0" style={{ background: 'radial-gradient(ellipse at 80% 50%, rgba(212,160,23,0.08) 0%, transparent 70%)' }} />
          <div className="absolute right-0 top-0 bottom-0 w-64 opacity-10"
            style={{ background: 'repeating-linear-gradient(45deg, #d4a017 0px, #d4a017 1px, transparent 0px, transparent 50%)' }} />

          <div className="relative px-8 py-8 flex items-center justify-between">
            <div className="max-w-md">
              <h1 className="text-2xl font-black leading-tight mb-2"
                style={{ fontFamily: 'Cinzel,serif', color: '#e8e2f5' }}>
                {t('aff_hero_title')}<br />
                <span style={{ color: '#d4a017' }}>{t('aff_hero_sub')}</span>
              </h1>
              <p className="text-[12px] leading-relaxed mb-5" style={{ color: '#6b6488' }}>
                {t('aff_hero_desc')}
              </p>
              {aff ? (
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-3 px-4 py-2.5 rounded-lg"
                    style={{ background: '#13111f', border: '1px solid #2a2640' }}>
                    <span className="text-[13px] font-mono font-bold tracking-widest" style={{ color: '#d4a017' }}>
                      {aff.code}
                    </span>
                    <button onClick={copyCode} className="hover:opacity-70 transition-opacity" title={copied ? t('common_copied') : t('common_copy')}>
                      {copied ? <Check size={14} style={{ color: '#22c55e' }} /> : <Copy size={14} style={{ color: '#6b6488' }} />}
                    </button>
                  </div>
                  <span className="text-[11px]" style={{ color: '#4a4468' }}>{t('aff_your_code_label')}</span>
                </div>
              ) : (
                <a href="mailto:partners@ageofmoney.gg"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-[13px] transition-opacity hover:opacity-80"
                  style={{ background: '#d4a017', color: '#07060f' }}>
                  {t('aff_become_partner')}
                </a>
              )}
            </div>

            {/* Tier badge */}
            <div className="hidden md:flex flex-col items-center gap-2 shrink-0 mr-8">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-3xl"
                style={{ background: `${currentTier.color}20`, border: `2px solid ${currentTier.color}60` }}>
                ⚜
              </div>
              <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: currentTier.color }}>
                {currentTier.name}
              </p>
              <p className="text-[10px]" style={{ color: '#4a4468' }}>{t('aff_current_tier')}</p>
            </div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 p-1 rounded-xl w-fit" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          {([['dashboard', t('aff_tab_dashboard')], ['tiers', t('aff_tab_tiers')]] as [TabType, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className="px-5 py-2 rounded-lg text-[12px] font-medium transition-all"
              style={{
                background: activeTab === id ? '#1a1630' : 'transparent',
                color: activeTab === id ? '#e8e2f5' : '#6b6488',
              }}>
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'dashboard' && !aff && (
          <div className="rounded-2xl p-10 text-center" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
            <Gift size={40} className="mx-auto mb-4" style={{ color: '#d4a017' }} />
            <h2 className="font-bold text-[18px] mb-2" style={{ fontFamily: 'Cinzel,serif', color: '#e8e2f5' }}>
              {t('aff_partner_title')}
            </h2>
            <p className="text-[13px] mb-1" style={{ color: '#6b6488' }}>
              {t('aff_partner_desc')}
            </p>
            <p className="text-[12px] mb-6" style={{ color: '#4a4468' }}>
              {t('aff_partner_desc2')}
            </p>
            <a href="mailto:partners@ageofmoney.gg"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-[14px] hover:opacity-80 transition-opacity"
              style={{ background: '#d4a017', color: '#07060f' }}>
              {t('aff_contact')}
            </a>
          </div>
        )}

        {activeTab === 'dashboard' && aff && (
          <>
            {/* ── Chart + Stats ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Chart */}
              <div className="lg:col-span-2 rounded-xl p-5" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[11px] uppercase tracking-widest" style={{ color: '#6b6488' }}>{t('aff_commissions')}</p>
                  <span className="text-[10px] px-2 py-0.5 rounded" style={{ background: '#1a1630', color: '#6b6488' }}>{t('aff_7days')}</span>
                </div>
                <p className="text-2xl font-bold mb-5" style={{ color: '#d4a017', fontFamily: 'Cinzel,serif' }}>
                  ⚜ {(aff?.totalEarnings ?? 0).toLocaleString('fr-FR')}
                </p>
                <div style={{ height: 100 }}>
                  <EarningsChart data={chartData} noDataLabel={t('aff_no_data')} />
                </div>
                {/* X axis labels */}
                <div className="flex justify-between mt-2">
                  {['-6','-5','-4','-3','-2','-1','0'].map(d => (
                    <span key={d} className="text-[9px]" style={{ color: '#3d3860' }}>{d}</span>
                  ))}
                </div>
              </div>

              {/* Stat cards */}
              <div className="space-y-3">
                {/* Available + Claim */}
                <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <Coins size={14} style={{ color: '#d4a017' }} />
                      <span className="text-[18px] font-bold" style={{ color: '#d4a017' }}>
                        {(aff?.available ?? 0).toLocaleString('fr-FR')}
                      </span>
                    </div>
                    <button onClick={claim} disabled={claiming || (aff?.available ?? 0) === 0}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all disabled:opacity-40"
                      style={{ background: '#d4a017', color: '#07060f' }}>
                      {claiming ? '...' : t('aff_claim')}
                    </button>
                  </div>
                  <p className="text-[11px]" style={{ color: '#6b6488' }}>{t('aff_available_commissions')}</p>
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
                      {(aff?.totalEarnings ?? 0).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: '#6b6488' }}>{t('aff_total_earned')}</p>
                </div>

                <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Coins size={14} style={{ color: '#6b6488' }} />
                    <span className="text-[18px] font-bold" style={{ color: '#e8e2f5' }}>
                      {(aff?.totalDeposited ?? 0).toLocaleString('fr-FR')}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: '#6b6488' }}>{t('aff_total_deposited_referrals')}</p>
                </div>

                <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <Users size={14} style={{ color: '#6b6488' }} />
                    <span className="text-[18px] font-bold" style={{ color: '#e8e2f5' }}>
                      {aff?.totalReferrals ?? 0}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: '#6b6488' }}>{t('aff_all_referrals')}</p>
                </div>

                <div className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <UserCheck size={14} style={{ color: '#6b6488' }} />
                    <span className="text-[18px] font-bold" style={{ color: '#e8e2f5' }}>
                      {aff?.activeReferrals ?? 0}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: '#6b6488' }}>{t('aff_active_referrals')}</p>
                </div>
              </div>
            </div>

            {/* ── Referrals table ── */}
            <div className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
              <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid #1e1a30' }}>
                {/* Search placeholder */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg flex-1 max-w-xs"
                  style={{ background: '#13111f', border: '1px solid #1a1730' }}>
                  <svg width="12" height="12" fill="none" stroke="#4a4468" strokeWidth="2" viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                  </svg>
                  <span className="text-[11px]" style={{ color: '#4a4468' }}>{t('aff_search')}</span>
                </div>
                <div className="flex items-center gap-1 ml-3">
                  {(['all', 'active'] as const).map(f => (
                    <button key={f} onClick={() => setReferralFilter(f)}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                      style={{
                        background: referralFilter === f ? '#1a1630' : 'transparent',
                        color: referralFilter === f ? '#e8e2f5' : '#6b6488',
                        border: `1px solid ${referralFilter === f ? '#2a2640' : 'transparent'}`,
                      }}>
                      {f === 'all' ? t('aff_filter_all') : t('aff_filter_active')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Table header */}
              <div className="grid grid-cols-6 px-5 py-2.5 text-[10px] uppercase tracking-widest"
                style={{ borderBottom: '1px solid #1a1730', color: '#4a4468' }}>
                <span className="col-span-2">{t('aff_col_player')}</span>
                <span>{t('aff_col_status')}</span>
                <span>{t('aff_col_joined')}</span>
                <span>{t('aff_col_deposited')}</span>
                <span>{t('aff_commission')}</span>
              </div>

              {filteredReferrals.length === 0 ? (
                <div className="text-center py-12">
                  <Users size={24} className="mx-auto mb-3" style={{ color: '#3d3860' }} />
                  <p className="text-[13px]" style={{ color: '#6b6488' }}>{t('aff_no_referrals')}</p>
                  <p className="text-[11px] mt-1" style={{ color: '#4a4468' }}>{t('aff_no_referrals_code', { code: aff?.code ?? '' })}</p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: '#1a1730' }}>
                  {filteredReferrals.map(r => (
                    <div key={r.id} className="grid grid-cols-6 items-center px-5 py-3 hover:bg-[#13111f] transition-colors">
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
                      <div>
                        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full',)}
                          style={{
                            background: r.isActive ? '#04200f' : '#13111f',
                            color: r.isActive ? '#22c55e' : '#4a4468',
                            border: `1px solid ${r.isActive ? '#22c55e33' : '#2a2640'}`,
                          }}>
                          {r.isActive ? t('aff_status_active') : t('aff_status_inactive')}
                        </span>
                      </div>
                      <span className="text-[11px]" style={{ color: '#6b6488' }}>
                        {new Date(r.joinedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                      </span>
                      <span className="text-[12px] font-medium" style={{ color: '#e8e2f5' }}>
                        {r.totalDeposited.toLocaleString('fr-FR')} ⚜
                      </span>
                      <span className="text-[12px] font-bold" style={{ color: '#d4a017' }}>
                        {r.commission.toLocaleString('fr-FR')} ⚜
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Tiers tab ── */}
        {activeTab === 'tiers' && (
          <div className="space-y-3">
            <p className="text-[12px]" style={{ color: '#6b6488' }}>
              {t('aff_tiers_desc')}
            </p>
            {TIERS.map((tier, i) => {
              const isActive = totalReferrals >= tier.referrals && (i === TIERS.length - 1 || totalReferrals < TIERS[i + 1].referrals);
              const unlocked = totalReferrals >= tier.referrals;
              return (
                <div key={tier.level}
                  className="rounded-xl p-5 transition-all"
                  style={{
                    background: '#0d0b1a',
                    border: `1px solid ${isActive ? tier.color : '#1e1a30'}`,
                    boxShadow: isActive ? `0 0 20px ${tier.color}22` : 'none',
                    opacity: unlocked ? 1 : 0.6,
                  }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bold text-[18px]"
                        style={{ background: `${tier.color}20`, border: `1.5px solid ${tier.color}60`, color: tier.color }}>
                        {tier.level}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-[14px]" style={{ fontFamily: 'Cinzel,serif', color: tier.color }}>
                            {tier.name}
                          </p>
                          {isActive && (
                            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                              style={{ background: `${tier.color}30`, color: tier.color, border: `1px solid ${tier.color}60` }}>
                              {t('aff_current_badge')}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] mt-0.5" style={{ color: '#6b6488' }}>
                          {tier.referrals === 0 ? t('aff_available_start') : t('aff_referrals_needed', { n: tier.referrals })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[24px] font-black" style={{ color: tier.color, fontFamily: 'Cinzel,serif' }}>
                        {tier.commission}
                      </p>
                      <p className="text-[10px]" style={{ color: '#4a4468' }}>{t('aff_per_deposit')}</p>
                    </div>
                  </div>
                  {/* Requirements */}
                  {tier.deposited > 0 && (
                    <div className="mt-4 flex flex-wrap gap-3 text-[11px]" style={{ color: '#6b6488' }}>
                      <span>📦 {new Intl.NumberFormat('fr-FR').format(tier.deposited)} ⚜ {t('aff_deposited')}</span>
                      <span>👥 {tier.referrals} {t('aff_referrals_needed', { n: '' }).replace('{n}', '').trim()}</span>
                      <span>⚡ {tier.activeReferrals} actifs</span>
                    </div>
                  )}
                  {/* Progress bar for next tier */}
                  {i < TIERS.length - 1 && (
                    <div className="mt-4">
                      <div className="flex justify-between text-[10px] mb-1" style={{ color: '#4a4468' }}>
                        <span>{t('aff_progress_label', { n: totalReferrals })}</span>
                        <span>Tier {TIERS[i + 1].level} → {TIERS[i + 1].commission}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1630' }}>
                        <div className="h-full rounded-full transition-all"
                          style={{
                            width: tier.deposited === 0 ? '100%' : `${Math.min(100, (Math.max(0, totalReferrals - tier.referrals) / Math.max(1, TIERS[i + 1].referrals - tier.referrals)) * 100)}%`,
                            background: tier.color,
                          }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
