'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState, useCallback } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';
import { Bet, UserStats, LeaderboardEntry } from '@/types';
import { getMyBets, getLeaderboard, apiClient } from '@/lib/api';
import { setAuthToken } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';
import {
  Settings, Clock, Shield, UserX, BadgeCheck, Users,
  BarChart2, Trophy, TrendingUp, TrendingDown, Coins,
  ChevronRight, Swords, Dices, Copy, Check, CheckCircle2, Mail, User2
} from 'lucide-react';

type TabType = 'profile' | 'settings' | 'security' | 'history';

interface RouletteBetHistory {
  id: string; zone: string; amount: number; payout: number | null; won: boolean | null; createdAt: string;
  round: { id: string; winZone: string | null; multiplier: number | null; status: string; completedAt: string | null; result: number | null };
}

// Level thresholds in coins wagered (1.69 coins = $1)
// $5 / $10 / $25 / $50 / $100 / $200 / $500 / $1k / $2k / $5k /
// $10k / $20k / $50k / $100k / $200k / $500k / $1M / $2M / $5M / max
// 1 coin wagered = 420 XP
const XP_THRESHOLDS = [
  0, 420, 4_200, 21_000, 63_000, 168_000, 420_000,
  1_050_000, 2_100_000, 4_200_000, 8_400_000, 21_000_000,
  42_000_000, 84_000_000, 210_000_000, 420_000_000, 840_000_000,
  1_680_000_000, 3_360_000_000, 8_400_000_000,
];

function getLevel(totalWagered: number): { level: number; pct: number } {
  const xp = Math.max(0, totalWagered) * 420;
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  level = Math.min(level, 20);
  const xpForLevel = XP_THRESHOLDS[level - 1] ?? 0;
  const xpForNext  = XP_THRESHOLDS[level]     ?? XP_THRESHOLDS[XP_THRESHOLDS.length - 1];
  const pct = xpForNext > xpForLevel
    ? Math.min(100, ((xp - xpForLevel) / (xpForNext - xpForLevel)) * 100)
    : 100;
  return { level, pct };
}

function levelColor(level: number): string {
  if (level >= 50) return '#a855f7';
  if (level >= 30) return '#06b6d4';
  if (level >= 20) return '#ffc542';
  if (level >= 10) return '#94a3b8';
  return '#78716c';
}

function StatPeriodCard({ title, won, played, count }: { title: string; won: number; played: number; count: number }) {
  const { t } = useT();
  const profit = won - played;
  return (
    <div className="rounded-xl p-4 flex flex-col gap-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
      <p className="text-[12px] text-[#6b6488] font-medium">{title}</p>
      <div className="space-y-3">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[#ffc542]">⚜</span>
            <span className={cn('text-[18px] font-bold', profit >= 0 ? 'text-[#ffc542]' : 'text-red-400')}>
              {new Intl.NumberFormat('fr-FR').format(won)}
            </span>
          </div>
          <p className="text-[11px] text-[#6b6488] mt-0.5">{t('profile_total_won')}</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <span className="text-[#6b6488]">⚜</span>
            <span className="text-[18px] font-bold text-[#c8c0e0]">
              {new Intl.NumberFormat('fr-FR').format(played)}
            </span>
          </div>
          <p className="text-[11px] text-[#6b6488] mt-0.5">{t('profile_total_wagered')}</p>
        </div>
        <div>
          <div className="flex items-center gap-1.5">
            <Swords size={12} className="text-[#6b6488]" />
            <span className="text-[18px] font-bold text-[#c8c0e0]">{count}</span>
          </div>
          <p className="text-[11px] text-[#6b6488] mt-0.5">{t('profile_total_bets')}</p>
        </div>
      </div>
    </div>
  );
}

// ── Settings Tab (extracted to avoid hooks-in-IIFE error) ────────────────────
function SettingsTab({ session, initialBio, onBioSaved }: { session: { user: { name?: string | null; email?: string | null; id?: string; coins: number; isAdmin: boolean; accessToken: string } }; initialBio: string; onBioSaved: (b: string) => void }) {
  const { t } = useT();
  const [settEmail, setSettEmail] = useState('');
  const [settBio,   setSettBio]   = useState(initialBio);
  const [saving,    setSaving]    = useState(false);
  const [saved,     setSaved]     = useState(false);
  const [copied,    setCopied]    = useState(false);
  const username = session.user.name ?? '';

  // Sync the bio textarea when the parent finishes fetching /users/me — useState's
  // initial value only fires once at mount, so without this the field stays empty
  // (or shows a stale default) even after the real bio arrives.
  useEffect(() => { setSettBio(initialBio); }, [initialBio]);

  const handleCopyId = () => {
    navigator.clipboard.writeText((session.user as { id?: string }).id ?? '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await apiClient.put('/users/me', { email: settEmail, bio: settBio });
      onBioSaved(settBio);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch {/* ignore */}
    finally { setSaving(false); }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
      <div className="px-6 py-4 border-b" style={{ borderColor: '#1e1a30', background: 'rgba(0,0,0,0.2)' }}>
        <h3 className="text-[13px] font-bold text-[#c8c0e0] uppercase tracking-widest font-cinzel">{t('settings_general')}</h3>
      </div>
      <div className="p-6 space-y-6">

        {/* Username */}
        <div>
          <label className="block text-[11px] font-semibold text-[#9990b8] uppercase tracking-widest mb-2">{t('settings_username')}</label>
          <div className="relative">
            <input readOnly value={username}
              className="w-full px-4 py-3 rounded-lg text-[13px] text-[#c8c0e0] outline-none cursor-not-allowed"
              style={{ background: '#13111f', border: '1px solid #1e1a30' }} />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <span className="text-[11px] text-[#6b6488]">{username.length}/32</span>
              <span className="text-[10px] text-[#6b6488] bg-[#1e1a30] px-2 py-0.5 rounded">Steam</span>
            </div>
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="block text-[11px] font-semibold text-[#9990b8] uppercase tracking-widest mb-2">{t('settings_email')}</label>
          <div className="relative">
            <input type="email" value={settEmail} onChange={e => setSettEmail(e.target.value)}
              placeholder="votre@email.com"
              className="w-full px-4 py-3 rounded-lg text-[13px] outline-none transition-colors placeholder-[#3d3860]"
              style={{ background: '#13111f', border: `1px solid ${settEmail ? '#22c55e44' : '#1e1a30'}`, color: '#c8c0e0' }} />
            {settEmail && <CheckCircle2 size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500" />}
          </div>
          <p className="text-[11px] text-[#6b6488] mt-1.5">
            {t('settings_email_hint')}
          </p>
        </div>

        {/* User ID */}
        <div>
          <label className="block text-[11px] font-semibold text-[#9990b8] uppercase tracking-widest mb-2">{t('settings_userid')}</label>
          <div className="relative">
            <input readOnly value={(session.user as { id?: string }).id ?? ''}
              className="w-full px-4 py-3 rounded-lg text-[13px] text-[#6b6488] outline-none cursor-default font-mono"
              style={{ background: '#13111f', border: '1px solid #1e1a30' }} />
            <button onClick={handleCopyId}
              className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors hover:text-[#ffc542]"
              style={{ color: copied ? '#22c55e' : '#6b6488' }}
              title={copied ? t('common_copied') : t('common_copy')}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
            </button>
          </div>
        </div>

        {/* Bio */}
        <div>
          <label className="block text-[11px] font-semibold text-[#9990b8] uppercase tracking-widest mb-2">{t('settings_bio')}</label>
          <div className="relative">
            <textarea value={settBio} onChange={e => setSettBio(e.target.value.slice(0, 200))}
              placeholder={t('settings_bio_placeholder')} rows={4}
              className="w-full px-4 py-3 rounded-lg text-[13px] text-[#c8c0e0] outline-none resize-none transition-colors placeholder-[#3d3860]"
              style={{ background: '#13111f', border: '1px solid #1e1a30' }} />
            <span className="absolute bottom-3 right-3 text-[10px] text-[#6b6488]">{settBio.length}/200</span>
          </div>
        </div>

        {/* Update */}
        <button onClick={handleSave} disabled={saving}
          className="px-6 py-2.5 rounded-lg text-[13px] font-bold font-cinzel transition-all hover:opacity-90 disabled:opacity-50"
          style={{ background: saved ? '#16a34a' : 'linear-gradient(135deg, #b8881a, #ffc542)', color: '#07060f' }}>
          {saving ? t('settings_updating') : saved ? `✓ ${t('settings_updated')}` : t('settings_update')}
        </button>
      </div>
    </div>
  );
}

// ── Security Tab ─────────────────────────────────────────────────────────────
function SecurityTab({ session }: { session: { user: { accessToken: string; id?: string } } }) {
  const { t } = useT();
  const [twofaEnabled, setTwofaEnabled] = useState(false);
  const [showSetup, setShowSetup]       = useState(false);
  const [otpauthUrl, setOtpauthUrl]     = useState('');
  const [verifyCode, setVerifyCode]     = useState('');
  const [verifyError, setVerifyError]   = useState('');
  const [verifySuccess, setVerifySuccess] = useState(false);
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [loadingDisable, setLoadingDisable] = useState(false);
  const [disableCode, setDisableCode]   = useState('');
  const [showDisable, setShowDisable]   = useState(false);
  const [disableError, setDisableError] = useState('');

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const browser = ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : ua.includes('Edge') ? 'Edge' : 'Navigateur';
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Linux') ? 'Linux' : ua.includes('Android') ? 'Android' : ua.includes('iPhone') ? 'iOS' : 'OS inconnu';
  const now = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Load current 2FA status on mount
  useEffect(() => {
    if (!session?.user?.accessToken) return;
    setAuthToken(session.user.accessToken);
    apiClient.get('/users/me').then(res => {
      if (res.data?.data?.totpEnabled) setTwofaEnabled(true);
    }).catch(() => {});
  }, [session]);

  const handleToggle = async () => {
    if (twofaEnabled) {
      setShowDisable(true);
    } else {
      // Call backend to generate real TOTP secret
      setLoadingSetup(true);
      try {
        setAuthToken(session.user.accessToken);
        const res = await apiClient.get('/users/2fa/setup');
        setOtpauthUrl(res.data.data.otpauthUrl);
        setShowSetup(true);
      } catch (err: unknown) {
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setVerifyError(msg || 'Erreur lors de la configuration 2FA');
      } finally {
        setLoadingSetup(false);
      }
    }
  };

  const handleEnable = async () => {
    if (verifyCode.length !== 6 || !/^\d{6}$/.test(verifyCode)) {
      setVerifyError(t('sec_invalid_code'));
      return;
    }
    try {
      setAuthToken(session.user.accessToken);
      await apiClient.post('/users/2fa/enable', { code: verifyCode });
      setVerifyError('');
      setVerifySuccess(true);
      setTwofaEnabled(true);
      setTimeout(() => { setShowSetup(false); setVerifySuccess(false); setVerifyCode(''); }, 1500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setVerifyError(msg || 'Code incorrect');
    }
  };

  const handleDisable = async () => {
    if (disableCode.length !== 6 || !/^\d{6}$/.test(disableCode)) {
      setDisableError(t('sec_invalid_code'));
      return;
    }
    setLoadingDisable(true);
    try {
      setAuthToken(session.user.accessToken);
      await apiClient.post('/users/2fa/disable', { code: disableCode });
      setTwofaEnabled(false);
      setShowDisable(false);
      setDisableCode('');
      setDisableError('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setDisableError(msg || 'Code incorrect');
    } finally {
      setLoadingDisable(false);
    }
  };

  const qrUrl = otpauthUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(otpauthUrl)}`
    : '';

  return (
    <div className="space-y-4">
      {/* Two-Factor */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: '#1e1a30', background: 'rgba(0,0,0,0.2)' }}>
          <h3 className="text-[11px] font-bold text-[#6b6488] uppercase tracking-widest font-cinzel">{t('sec_twofactor')}</h3>
        </div>

        {/* Toggle row */}
        <div className="px-6 py-4 flex items-center justify-between gap-4" style={showSetup ? { borderBottom: '1px solid #1e1a30' } : {}}>
          <div>
            <p className="text-[13px] font-semibold text-[#c8c0e0]">{t('sec_2fa_title')}</p>
            <p className="text-[11px] text-[#6b6488] mt-0.5">
              {t('sec_2fa_desc')}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={loadingSetup}
            className="relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-60"
            style={{ background: twofaEnabled ? '#ffc542' : '#2a2640' }}
          >
            <span
              className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow"
              style={{ transform: twofaEnabled ? 'translateX(20px)' : 'translateX(0)' }}
            />
          </button>
        </div>

        {/* Disable confirmation */}
        {showDisable && (
          <div className="px-6 py-5 space-y-3" style={{ borderTop: '1px solid #1e1a30' }}>
            <p className="text-[12px] text-[#9990b8]">{t('sec_disable_prompt')}</p>
            <input
              type="text" inputMode="numeric" maxLength={6}
              value={disableCode}
              onChange={(e) => { setDisableCode(e.target.value.replace(/\D/g, '')); setDisableError(''); }}
              placeholder="000000"
              className="w-full rounded-lg px-4 py-3 text-center text-xl tracking-[0.4em] font-mono text-[#e8e2f5] placeholder-[#3d3860] outline-none"
              style={{ background: '#07060f', border: `1px solid ${disableError ? '#ef4444' : '#1e1a30'}` }}
            />
            {disableError && <p className="text-red-400 text-[11px]">{disableError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setShowDisable(false); setDisableCode(''); setDisableError(''); }}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold text-[#6b6488] hover:text-[#c8c0e0] border border-[#1e1a30] transition-colors">
                {t('sec_cancel')}
              </button>
              <button onClick={handleDisable} disabled={loadingDisable}
                className="flex-1 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-60"
                style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                {loadingDisable ? t('common_loading') : t('sec_disable')}
              </button>
            </div>
          </div>
        )}

        {/* Setup panel — visible when toggle clicked and not yet confirmed */}
        {showSetup && !twofaEnabled && (
          <div className="px-6 py-5 space-y-4">
            {/* QR code */}
            <div
              className="rounded-lg flex flex-col items-center justify-center py-6 gap-3"
              style={{ background: '#07060f', border: '1px solid #1e1a30' }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrUrl}
                alt="QR Code 2FA"
                width={120}
                height={120}
                className="rounded"
                style={{ imageRendering: 'pixelated' }}
              />
              <p className="text-[11px] text-center text-[#6b6488] max-w-xs leading-relaxed">
                {t('sec_2fa_backup')}
              </p>
            </div>

            {/* Verification code input */}
            <div>
              <label className="block text-[12px] font-semibold text-[#c8c0e0] mb-2">
                {t('sec_verify_code')}
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={verifyCode}
                onChange={(e) => { setVerifyCode(e.target.value.replace(/\D/g, '')); setVerifyError(''); }}
                placeholder="Enter the authentication code from the app..."
                className="w-full rounded-lg px-4 py-3 text-[13px] text-[#c8c0e0] placeholder-[#3d3860] outline-none transition-colors"
                style={{ background: '#07060f', border: `1px solid ${verifyError ? '#ef4444' : '#1e1a30'}` }}
              />
              {verifyError && (
                <p className="text-[11px] text-red-400 mt-1">{verifyError}</p>
              )}
              {verifySuccess && (
                <p className="text-[11px] text-emerald-400 mt-1">{t('sec_success')}</p>
              )}
            </div>

            <button
              onClick={handleEnable}
              className="px-5 py-2.5 rounded-lg text-[13px] font-bold transition-colors"
              style={{ background: 'linear-gradient(135deg, #b8881a, #ffc542)', color: '#07060f' }}
            >
              {t('sec_enable')}
            </button>
          </div>
        )}
      </div>

      {/* Sessions */}
      <div className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
        <div className="px-6 py-4 border-b" style={{ borderColor: '#1e1a30', background: 'rgba(0,0,0,0.2)' }}>
          <h3 className="text-[11px] font-bold text-[#6b6488] uppercase tracking-widest font-cinzel">{t('sec_sessions')}</h3>
        </div>

        <div className="px-6 py-4 flex items-center justify-between gap-4" style={{ borderBottom: '1px solid #13111f' }}>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <p className="text-[13px] font-semibold text-[#c8c0e0]">{browser}, {os}</p>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(255,197,66,0.12)', color: '#ffc542', border: '1px solid rgba(255,197,66,0.25)' }}>
                {t('sec_current_session')}
              </span>
            </div>
            <p className="text-[11px] text-[#6b6488]">{now}</p>
          </div>
          <button
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors shrink-0"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171' }}
            onClick={() => {}}
          >
            {t('sec_end_session')}
          </button>
        </div>

        <div className="px-6 py-4 text-center">
          <p className="text-[11px] text-[#3d3860]">{t('sec_no_other_sessions')}</p>
        </div>
      </div>
    </div>
  );
}

const TAB_IDS: { id: TabType; icon: typeof BarChart2 | typeof Settings | typeof Shield | typeof Clock; key: string }[] = [
  { id: 'profile',  icon: BarChart2, key: 'profile_tab_profile' },
  { id: 'settings', icon: Settings,  key: 'profile_tab_settings' },
  { id: 'security', icon: Shield,    key: 'profile_tab_security' },
  { id: 'history',  icon: Clock,     key: 'profile_tab_history' },
];

function BetStatusBadge({ status }: { status: string }) {
  const { t } = useT();
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    WON:      { label: t('profile_history_won'),     bg: '#04200f', color: '#22c55e' },
    LOST:     { label: t('profile_history_lost'),    bg: '#200404', color: '#ef4444' },
    PENDING:  { label: t('profile_history_pending'), bg: '#201a04', color: '#ffc542' },
    REFUNDED: { label: t('common_pending'),          bg: '#131025', color: '#6b6488' },
    CANCELLED:{ label: t('common_pending'),          bg: '#131025', color: '#6b6488' },
  };
  const c = cfg[status] ?? cfg.CANCELLED;
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: c.bg, color: c.color, border: `1px solid ${c.color}33` }}>
      {c.label}
    </span>
  );
}

interface PeriodStat { wagered: number; won: number; count: number; }
interface PublicProfile {
  id: string; username: string; avatar: string | null; bio: string | null;
  coins: number; totalWagered: number; isAdmin: boolean; isMod: boolean; isPartner: boolean;
  createdAt: string; _count: { bets: number; rouletteBets: number };
  stats?: { d7: PeriodStat; d30: PeriodStat; total: PeriodStat };
}

export default function ProfilePage() {
  const { t } = useT();
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const viewId = searchParams.get('id');

  const [activeTab, setActiveTab] = useState<TabType>('profile');
  const [bets, setBets]           = useState<Bet[]>([]);
  const [betsTotal, setBetsTotal] = useState(0);
  const [stats, setStats]         = useState<UserStats | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [rouletteBets, setRouletteBets] = useState<RouletteBetHistory[]>([]);
  const [historyFilter, setHistoryFilter] = useState<'all' | 'match' | 'roulette'>('all');
  const [loading, setLoading]     = useState(true);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [profileBio, setProfileBio] = useState('');
  const [profileCreatedAt, setProfileCreatedAt] = useState<string | null>(null);
  const [publicProfile, setPublicProfile] = useState<PublicProfile | null>(null);
  const [publicLoading, setPublicLoading] = useState(false);

  // If ?id= is set and differs from own id, fetch public profile
  const isViewingOther = viewId && viewId !== (session?.user as { id?: string })?.id;

  useEffect(() => {
    if (!isViewingOther || !viewId) return;
    setPublicLoading(true);
    apiClient.get(`/users/${viewId}`)
      .then(res => setPublicProfile(res.data.data ?? null))
      .catch(() => setPublicProfile(null))
      .finally(() => setPublicLoading(false));
  }, [viewId, isViewingOther]);

  const fetchProfileData = useCallback(async () => {
    if (!session || isViewingOther) { setLoading(false); return; }
    if (session.user.accessToken) setAuthToken(session.user.accessToken);

    // Phase 1: fetch user profile (fast — shows header immediately)
    try {
      const meRes = await apiClient.get('/users/me').catch(() => null);
      if (meRes?.data?.data?.bio != null) setProfileBio(meRes.data.data.bio ?? '');
      if (meRes?.data?.data?.createdAt) setProfileCreatedAt(meRes.data.data.createdAt as string);
    } catch { /* ignore */ }
    setLoading(false);

    // Phase 2: fetch heavy data in background (bets, leaderboard, roulette)
    Promise.all([
      getMyBets({ limit: 50 }).catch(() => null),
      getLeaderboard().catch(() => null),
      apiClient.get('/roulette/my').catch(() => null),
    ]).then(([betsRes, lbRes, rouRes]) => {
      if (betsRes) {
        setBets(betsRes.data);
        setBetsTotal(betsRes.total);
        if (betsRes.stats) setStats(betsRes.stats);
      }
      if (lbRes) setLeaderboard(lbRes.data);
      if (rouRes) setRouletteBets(rouRes.data.data ?? []);
      setDataLoaded(true);
    });
  }, [session, isViewingOther]);

  useEffect(() => { fetchProfileData(); }, [fetchProfileData]);

  // Refetch on tab focus
  useEffect(() => {
    const onFocus = () => { if (dataLoaded) fetchProfileData(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchProfileData, dataLoaded]);

  // Only spinner on the very first load — not on tab-refocus revalidations
  if (status === 'loading' && !session && !dataLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="w-8 h-8 border-2 border-[#ffc542] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="text-center p-8 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          <h2 className="font-bold text-lg text-[#ffc542] mb-2" style={{ fontFamily: 'Cinzel, serif' }}>{t('auth_required')}</h2>
          <p className="text-[#6b6488] text-sm mb-5">{t('auth_required_desc')}</p>
          {/* Bouton Steam bleu (même style que /deposit) — plus cohérent
              avec l'identité Steam qu'un bouton or générique. */}
          <button
            onClick={() => signIn('steam')}
            className="w-full flex items-center justify-center gap-3 py-3 rounded-xl font-bold text-sm transition-all hover:brightness-110 active:scale-[0.99]"
            style={{ background: 'linear-gradient(135deg, #2a475e, #1b2838)', border: '1px solid #4c6b8a', color: 'white' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="white" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.003.187.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.029 4.524 4.524s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.718L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.956.4 1.409 1.5 1.009 2.455-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
            </svg>
            {t('auth_signin_steam')}
          </button>
        </div>
      </div>
    );
  }

  // ── Public profile view (viewing someone else) ────────────────────────────
  if (isViewingOther) {
    if (publicLoading) return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="w-8 h-8 border-2 border-[#ffc542] border-t-transparent rounded-full animate-spin" />
      </div>
    );
    if (!publicProfile) return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: '#07060f' }}>
        <div className="text-center p-8 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          <div className="text-3xl mb-3">⚔</div>
          <h2 className="font-bold text-lg text-[#ffc542] mb-2" style={{ fontFamily: 'Cinzel, serif' }}>Utilisateur introuvable</h2>
          <Link href="/profile" className="text-[#6b6488] text-sm hover:text-[#ffc542]">← Retour à mon profil</Link>
        </div>
      </div>
    );
    const pubLvl = getLevel(publicProfile.totalWagered);
    const pubColor = levelColor(pubLvl.level);
    const pubJoined = new Date(publicProfile.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    return (
      <div className="min-h-screen" style={{ background: '#07060f' }}>
        <div className="max-w-2xl mx-auto px-4 py-10 space-y-4">
          <Link href="/profile" className="text-[11px] text-[#6b6488] hover:text-[#ffc542] transition-colors">← Retour à mon profil</Link>
          <div className="rounded-xl p-6 relative overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
            <div className="absolute inset-0 opacity-10" style={{ background: `radial-gradient(ellipse at top right, ${pubColor}, transparent 60%)` }} />
            <div className="relative flex items-center gap-5">
              <div className="relative shrink-0">
                <div className="w-20 h-20 rounded-full overflow-hidden" style={{ border: `2px solid ${pubColor}66` }}>
                  {publicProfile.avatar ? (
                    <Image src={publicProfile.avatar} alt="Avatar" width={80} height={80} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl font-bold" style={{ background: '#1a1630', color: pubColor }}>
                      {publicProfile.username.slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 text-[10px] font-bold px-1.5 rounded-full"
                  style={{ background: pubColor, color: '#07060f', lineHeight: '18px' }}>
                  {pubLvl.level}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-bold text-[#e8e2f5] truncate" style={{ fontFamily: 'Cinzel, serif' }}>{publicProfile.username}</h1>
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {publicProfile.isAdmin && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: '#be123c33', color: '#f87171', border: '1px solid #be123c55' }}>ADMIN</span>}
                  {publicProfile.isMod && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: '#1e3a5f', color: '#60a5fa', border: '1px solid #3b82f640' }}>MOD</span>}
                  {publicProfile.isPartner && <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,197,66,0.1)', color: '#ffc542', border: '1px solid rgba(255,197,66,0.3)' }}>PARTENAIRE</span>}
                  {!publicProfile.isAdmin && !publicProfile.isMod && !publicProfile.isPartner && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,197,66,0.1)', color: '#ffc542', border: '1px solid rgba(255,197,66,0.3)' }}>MEMBRE</span>
                  )}
                </div>
                <p className="text-[13px] mt-2 italic" style={{ color: publicProfile.bio ? '#9990b8' : '#3d3860' }}>
                  {publicProfile.bio ? `"${publicProfile.bio}"` : 'Aucune bio renseignée'}
                </p>
              </div>
            </div>
            {/* XP bar */}
            <div className="relative mt-5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[12px] font-semibold" style={{ color: pubColor }}>Niveau {pubLvl.level}</span>
                <span className="text-[11px] text-[#6b6488]">{pubLvl.pct.toFixed(1)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1e1a30' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${pubLvl.pct}%`, background: pubColor }} />
              </div>
            </div>
          </div>
          {/* Period stats */}
          {publicProfile.stats && (() => {
            const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);
            const periods = [
              { label: '7 derniers jours', s: publicProfile.stats.d7 },
              { label: '30 derniers jours', s: publicProfile.stats.d30 },
              { label: 'Total', s: publicProfile.stats.total },
            ];
            return periods.map(({ label, s }) => (
              <div key={label} className="rounded-xl p-4" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
                <p className="text-[11px] text-[#6b6488] font-medium mb-3">{label}</p>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="text-[#ffc542] text-xs">⚜</span>
                      <span className="text-[16px] font-bold text-[#ffc542]">{fmt(s.won)}</span>
                    </div>
                    <p className="text-[10px] text-[#6b6488] mt-0.5">Total gagné</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <span className="text-[#6b6488] text-xs">⚜</span>
                      <span className="text-[16px] font-bold text-[#c8c0e0]">{fmt(s.wagered)}</span>
                    </div>
                    <p className="text-[10px] text-[#6b6488] mt-0.5">Total misé</p>
                  </div>
                  <div>
                    <div className="flex items-center gap-1">
                      <Swords size={12} className="text-[#6b6488]" />
                      <span className="text-[16px] font-bold text-[#c8c0e0]">{s.count}</span>
                    </div>
                    <p className="text-[10px] text-[#6b6488] mt-0.5">Paris</p>
                  </div>
                </div>
              </div>
            ));
          })()}
          <p className="text-[11px] text-[#3d3860] text-center">Membre depuis le {pubJoined}</p>
        </div>
      </div>
    );
  }

  const s = stats;
  const lvl = getLevel(s?.totalWagered ?? 0);
  const color = levelColor(lvl.level);
  // Use the createdAt from /users/me (real DB value); fall back to "Recently"
  // only while the request is still in flight.
  const joinedAt = profileCreatedAt
    ? new Date(profileCreatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
    : t('profile_recently');

  // Compute period stats from both match bets + roulette bets
  const now = Date.now();
  const bets7d   = bets.filter(b => now - new Date(b.createdAt).getTime() < 7  * 86400000);
  const bets30d  = bets.filter(b => now - new Date(b.createdAt).getTime() < 30 * 86400000);
  const rou7d    = rouletteBets.filter(b => now - new Date(b.createdAt).getTime() < 7  * 86400000);
  const rou30d   = rouletteBets.filter(b => now - new Date(b.createdAt).getTime() < 30 * 86400000);

  const sumWon   = (arr: Bet[], rou: RouletteBetHistory[]) =>
    arr.filter(b => b.status === 'WON').reduce((a, b) => a + (b.payout ?? 0), 0)
    + rou.filter(b => b.won === true).reduce((a, b) => a + (b.payout ?? 0), 0);
  const sumPlayed= (arr: Bet[], rou: RouletteBetHistory[]) =>
    arr.reduce((a, b) => a + b.amount, 0)
    + rou.reduce((a, b) => a + b.amount, 0);
  const sumCount = (arr: Bet[], rou: RouletteBetHistory[]) => arr.length + rou.length;

  return (
    <div className="min-h-screen" style={{ background: '#07060f' }}>
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">

        {/* ── Profile header card ────────────────────────────────────────── */}
        <div className="rounded-xl p-5 relative overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          {/* Subtle gradient background */}
          <div className="absolute inset-0 opacity-10" style={{ background: `radial-gradient(ellipse at top right, ${color}, transparent 60%)` }} />

          <div className="relative flex flex-col sm:flex-row items-start justify-between gap-4">
            {/* Left: avatar + info */}
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="w-20 h-20 rounded-full overflow-hidden" style={{ border: `2px solid ${color}66` }}>
                  {session.user.image ? (
                    <Image src={session.user.image} alt="Avatar" width={80} height={80} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xl font-bold" style={{ background: '#1a1630', color }}>
                      {(session.user.name || 'U').slice(0, 2).toUpperCase()}
                    </div>
                  )}
                </div>
                {/* Level badge on avatar */}
                <div className="absolute -bottom-1 -right-1 text-[10px] font-bold px-1.5 rounded-full"
                  style={{ background: color, color: '#07060f', lineHeight: '18px' }}>
                  {lvl.level}
                </div>
              </div>

              <div>
                <h1 className="text-2xl font-bold text-[#e8e2f5]" style={{ fontFamily: 'Cinzel, serif' }}>
                  {session.user.name}
                </h1>
                <div className="mt-1.5">
                  {session.user.isAdmin ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: '#be123c33', color: '#f87171', border: '1px solid #be123c55' }}>ADMIN</span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={{ background: 'rgba(255,197,66,0.1)', color: '#ffc542', border: '1px solid rgba(255,197,66,0.3)' }}>MEMBRE</span>
                  )}
                </div>
                {profileBio && (
                  <p className="text-[13px] text-[#9990b8] mt-2 max-w-xs italic">"{profileBio}"</p>
                )}
              </div>
            </div>

            {/* Right: joined date */}
            <div className="text-right shrink-0">
              <p className="text-[12px] text-[#6b6488]">{t('profile_member_since')} {joinedAt}</p>
            </div>
          </div>

          {/* XP bar */}
          <div className="relative mt-5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[12px] font-semibold" style={{ color }}>
                {t('profile_level')} {lvl.level}
              </span>
              <span className="text-[11px] text-[#6b6488]">{lvl.pct.toFixed(1)}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1a1630' }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${lvl.pct}%`,
                  background: `linear-gradient(90deg, ${color}88, ${color})`,
                  boxShadow: `0 0 8px ${color}66`,
                }}
              />
            </div>
          </div>
        </div>

        {/* ── Tabs ─────────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-1 p-1 rounded-xl" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
          {TAB_IDS.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-[12px] font-medium transition-all',
                activeTab === tab.id
                  ? 'text-[#ffc542]'
                  : 'text-[#6b6488] hover:text-[#c8c0e0]'
              )}
              style={activeTab === tab.id ? { background: '#1a1630' } : {}}
            >
              <tab.icon size={13} />
              {t(tab.key)}
            </button>
          ))}
        </div>

        {/* ── Profile tab content ───────────────────────────────────────────── */}
        {activeTab === 'profile' && (
          <div className="space-y-4">
            {/* Period stats cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <StatPeriodCard
                title={t('profile_last_7d')}
                won={sumWon(bets7d, rou7d)}
                played={sumPlayed(bets7d, rou7d)}
                count={sumCount(bets7d, rou7d)}
              />
              <StatPeriodCard
                title={t('profile_last_30d')}
                won={sumWon(bets30d, rou30d)}
                played={sumPlayed(bets30d, rou30d)}
                count={sumCount(bets30d, rou30d)}
              />
              <StatPeriodCard
                title="Total"
                won={s?.totalPayout ?? 0}
                played={s?.totalWagered ?? 0}
                count={s?.totalBets ?? betsTotal}
              />
            </div>

          </div>
        )}

        {/* ── History tab ───────────────────────────────────────────────────── */}
        {activeTab === 'history' && (() => {
          const ZONE_COLORS: Record<string, string> = { KNIGHTS: '#94a3b8', EMPEROR: '#ffd97a', ARCHERS: '#fb923c' };
          const ZONE_LABELS: Record<string, string> = { KNIGHTS: 'Chevaliers', EMPEROR: 'Emperor', ARCHERS: 'Archers' };

          // Merge & sort all bets
          type MergedItem = { type: 'match'; bet: Bet; ts: number } | { type: 'roulette'; bet: RouletteBetHistory; ts: number };
          const matchItems: MergedItem[] = bets.map(b => ({ type: 'match' as const, bet: b, ts: new Date(b.createdAt).getTime() }));
          const rouItems:   MergedItem[] = rouletteBets.map(b => ({ type: 'roulette' as const, bet: b, ts: new Date(b.createdAt).getTime() }));
          const all = [...matchItems, ...rouItems].sort((a, b) => b.ts - a.ts);
          const filtered = historyFilter === 'all' ? all : all.filter(i => i.type === historyFilter);
          const totalCount = filtered.length;

          return (
            <div className="rounded-xl overflow-hidden" style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>
              {/* Header + filters */}
              <div className="px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap" style={{ borderColor: '#1e1a30' }}>
                <span className="text-[13px] font-semibold text-[#c8c0e0]">{t('profile_tab_history')}</span>
                <div className="flex items-center gap-2">
                  {(['all', 'match', 'roulette'] as const).map(f => (
                    <button key={f} onClick={() => setHistoryFilter(f)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all"
                      style={{
                        background: historyFilter === f ? '#1e1a30' : 'transparent',
                        color: historyFilter === f ? '#e8e2f5' : '#6b6488',
                        border: `1px solid ${historyFilter === f ? '#2a2640' : 'transparent'}`,
                      }}>
                      {f === 'all' && <><Swords size={11} /> Tout</>}
                      {f === 'match' && <><Swords size={11} /> Match</>}
                      {f === 'roulette' && <><Dices size={11} /> Roulette</>}
                    </button>
                  ))}
                </div>
              </div>

              {loading ? (
                <div className="flex justify-center py-10">
                  <div className="w-6 h-6 border-2 border-[#ffc542] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-12">
                  <Swords size={24} className="mx-auto mb-3 text-[#3d3860]" />
                  <p className="text-[13px] text-[#6b6488]">{t('profile_no_history')}</p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: '#1a1730' }}>
                  {filtered.map(item => {
                    // Shared formatter — keeps numbers compact and consistent
                    const fmt = (n: number) => new Intl.NumberFormat('fr-FR').format(n);

                    if (item.type === 'match') {
                      const bet = item.bet;
                      const playerName = bet.selectedPlayer === 1 ? bet.match.player1.name : bet.match.player2.name;
                      const payout = bet.payout ?? 0;
                      const profit = payout - bet.amount;
                      return (
                        <div key={`m-${bet.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-[#13111f] transition-colors">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: '#1a1630', border: '1px solid #2a2640' }}>
                            <Swords size={11} style={{ color: '#6b6488' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <Link href={`/matches/${bet.matchId}`} className="hover:text-[#ffc542] transition-colors">
                              <p className="text-[13px] font-medium text-[#c8c0e0] truncate">
                                <span className="text-[#6b6488]">{playerName}</span>
                                <span className="text-[#3d3860] mx-1.5">·</span>
                                {bet.match.player1.name} vs {bet.match.player2.name}
                              </p>
                            </Link>
                          </div>
                          <div className="shrink-0 text-[11px] text-[#6b6488] tabular-nums whitespace-nowrap">
                            {fmt(bet.amount)} ⚜ <span className="text-[#3d3860]">× {bet.oddsAtBet.toFixed(2)}</span>
                          </div>
                          <div className="text-right shrink-0 w-24 tabular-nums">
                            {bet.status === 'WON'      && <p className="text-[13px] font-bold text-emerald-400">+{fmt(profit)} ⚜</p>}
                            {bet.status === 'LOST'     && <p className="text-[13px] font-bold text-red-400">−{fmt(bet.amount)} ⚜</p>}
                            {bet.status === 'PENDING'  && <p className="text-[12px] text-[#6b6488]">{t('profile_history_pending')}</p>}
                            {bet.status === 'REFUNDED' && <p className="text-[12px] text-[#6b6488]">{t('common_pending')}</p>}
                          </div>
                        </div>
                      );
                    } else {
                      const bet = item.bet;
                      const zoneLabel = ZONE_LABELS[bet.zone] ?? bet.zone;
                      const winLabel  = bet.round.winZone ? (ZONE_LABELS[bet.round.winZone] ?? bet.round.winZone) : null;
                      const payout = bet.payout ?? 0;
                      const profit = payout - bet.amount;
                      return (
                        <div key={`r-${bet.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-[#13111f] transition-colors">
                          <div className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0"
                            style={{ background: '#1a1630', border: '1px solid #2a2640' }}>
                            <Dices size={11} style={{ color: '#6b6488' }} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-[#c8c0e0] truncate">
                              {zoneLabel}
                              {winLabel && <>
                                <span className="text-[#3d3860] mx-1.5">→</span>
                                <span className="text-[#6b6488]">{winLabel}</span>
                              </>}
                            </p>
                          </div>
                          <div className="shrink-0 text-[11px] text-[#6b6488] tabular-nums whitespace-nowrap">
                            {fmt(bet.amount)} ⚜ <span className="text-[#3d3860]">× {bet.round.multiplier ?? '?'}</span>
                          </div>
                          <div className="text-right shrink-0 w-24 tabular-nums">
                            {bet.won === true  && <p className="text-[13px] font-bold text-emerald-400">+{fmt(profit)} ⚜</p>}
                            {bet.won === false && <p className="text-[13px] font-bold text-red-400">−{fmt(bet.amount)} ⚜</p>}
                            {bet.won === null  && <p className="text-[12px] text-[#6b6488]">{t('profile_history_pending')}</p>}
                          </div>
                        </div>
                      );
                    }
                  })}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Settings tab ─────────────────────────────────────────────────── */}
        {activeTab === 'settings' && <SettingsTab session={session} initialBio={profileBio} onBioSaved={setProfileBio} />}

        {/* ── Security tab ─────────────────────────────────────────────────── */}
        {activeTab === 'security' && <SecurityTab session={session} />}
      </div>
    </div>
  );
}
