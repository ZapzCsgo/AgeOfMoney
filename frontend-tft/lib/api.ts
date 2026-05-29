import axios from 'axios';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export const apiClient = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  timeout: 20_000,
});

apiClient.interceptors.request.use((config) => {
  if (authToken) config.headers.Authorization = `Bearer ${authToken}`;
  return config;
});

// ── Domain types — mirror what /api/v1/tft/* actually returns ─────────────

export interface TftParticipant {
  id: string;
  playerId: string;
  name: string;
  country: string | null;
  avatarUrl: string | null;
  /** "CHALLENGER 845 LP", "DIAMOND I (32 LP)", or null when no Riot snapshot yet. */
  currentTier: string | null;
  /** Already accounts for manualOdds override — render as-is. */
  odds: number;
  /** Live placement during the tournament (1 = leading, 8 = last). Null pre-bracket. */
  currentRank: number | null;
  /** Final ranking after settlement. 1 = winner. */
  finalRank: number | null;
  isWinner: boolean;
}

export interface TftTournament {
  id: string;
  name: string;
  tier: string; // 'S' | 'A'
  game: 'TFT';
  prizePool: string | null;
  startDate: string;
  endDate: string | null;
  liquipediaUrl: string | null;
  competeTftUrl: string | null;
  twitchChannel: string | null;
  /** Once true, bet form is locked client-side AND server-side. */
  bracketStarted: boolean;
  lastLiveSync: string | null;
  liveSyncSource: string | null;
  /** Up to 5 favourites on list endpoint, full roster on detail endpoint. */
  participants?: TftParticipant[];
}

export interface TftBet {
  id: string;
  tournamentId: string;
  tournamentName: string;
  participantName: string;
  participantCountry: string | null;
  stake: string;
  oddsAtBet: string;
  potentialPayout: string;
  status: 'PENDING' | 'WON' | 'LOST' | 'REFUNDED' | 'CANCELLED';
  payout: string | null;
  placedAt: string;
  settledAt: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export async function getTftTournaments(params?: {
  status?: 'upcoming' | 'live' | 'completed' | 'all';
  limit?: number;
}): Promise<TftTournament[]> {
  const res = await apiClient.get('/tft/tournaments', { params });
  return (res.data?.data ?? []) as TftTournament[];
}

export async function getTftTournament(id: string): Promise<TftTournament | null> {
  try {
    const res = await apiClient.get(`/tft/tournaments/${id}`);
    return (res.data?.data ?? null) as TftTournament | null;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw err;
  }
}

export async function placeTournamentWinnerBet(input: {
  tournamentId: string;
  participantId: string;
  stake: number;
  expectedOdds?: number;
}): Promise<{
  id: string;
  stake: string;
  oddsAtBet: string;
  potentialPayout: string;
  placedAt: string;
}> {
  const res = await apiClient.post('/tft/bets/tournament-winner', input);
  return res.data?.data;
}

export async function getMyTftBets(status?: TftBet['status']): Promise<TftBet[]> {
  const res = await apiClient.get('/tft/bets/mine', { params: status ? { status } : undefined });
  return (res.data?.data ?? []) as TftBet[];
}

export function formatCoins(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(num) ? num : 0);
}

// ── Shared backend endpoints (same as AoM) ────────────────────────────────

export interface MeResponse {
  id: string;
  username: string;
  email: string | null;
  avatar: string | null;
  coins: number;
  totalWagered: number;
  isAdmin: boolean;
  isOwner: boolean;
  createdAt: string;
}

export async function getMe(): Promise<MeResponse | null> {
  try {
    const res = await apiClient.get('/users/me');
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  avatar: string | null;
  totalWagered: number;
  totalWon?: number;
  totalBets?: number;
}

export async function getTftLeaderboard(period: 'all' | 'month' | 'week' = 'month'): Promise<LeaderboardEntry[]> {
  try {
    const res = await apiClient.get('/users/leaderboard', { params: { game: 'TFT', period, limit: 50 } });
    return (res.data?.data ?? []) as LeaderboardEntry[];
  } catch {
    return [];
  }
}

export interface AffiliateInfo {
  code: string | null;
  totalReferrals: number;
  pendingCommission: number;
  paidCommission: number;
  referrals?: Array<{ username: string; joinedAt: string; status: string; commission: number }>;
}

export async function getAffiliateInfo(): Promise<AffiliateInfo | null> {
  try {
    const res = await apiClient.get('/affiliate/me');
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}

export async function createAffiliateCode(code: string): Promise<{ code: string } | { error: string }> {
  try {
    const res = await apiClient.post('/affiliate/code', { code });
    return res.data?.data ?? { error: 'Erreur' };
  } catch (err: unknown) {
    const ax = err as { response?: { data?: { error?: string } } };
    return { error: ax.response?.data?.error ?? 'Erreur' };
  }
}

// ── Payments (crypto) ─────────────────────────────────────────────────────

export interface CryptoMethod {
  code: string;          // "btc" | "eth" | "usdt-trc20" | ...
  label: string;
  iconUrl?: string;
  minDepositUsd: number;
}

export async function getCryptoMethods(): Promise<CryptoMethod[]> {
  try {
    const res = await apiClient.get('/payments/crypto/methods');
    return (res.data?.data ?? []) as CryptoMethod[];
  } catch {
    return [];
  }
}

export interface CryptoDeposit {
  address: string;
  qrCodeUrl: string;
  amount: string;
  currency: string;
  expectedCoins: number;
  expiresAt: string;
}

export async function createCryptoDeposit(input: {
  currency: string;
  amountUsd: number;
}): Promise<CryptoDeposit | null> {
  try {
    const res = await apiClient.post('/payments/crypto/create', input);
    return res.data?.data ?? null;
  } catch {
    return null;
  }
}

export async function createCryptoWithdrawal(input: {
  currency: string;
  amountCoins: number;
  destinationAddress: string;
}): Promise<{ id: string; status: string } | { error: string }> {
  try {
    const res = await apiClient.post('/payments/crypto/withdraw', input);
    return res.data?.data ?? { error: 'Erreur' };
  } catch (err: unknown) {
    const ax = err as { response?: { data?: { error?: string } } };
    return { error: ax.response?.data?.error ?? 'Erreur' };
  }
}

export async function openSupportTicket(input: {
  subject: string;
  message: string;
}): Promise<{ id: string } | { error: string }> {
  try {
    const res = await apiClient.post('/support/ticket', input);
    return res.data?.data ?? { error: 'Erreur' };
  } catch (err: unknown) {
    const ax = err as { response?: { data?: { error?: string } } };
    return { error: ax.response?.data?.error ?? 'Erreur' };
  }
}
