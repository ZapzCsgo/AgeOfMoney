import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { Match, Player, Tournament, Bet, User, LeaderboardEntry, WeeklyLeaderboardEntry, PaginatedResponse, ApiResponse, UserStats, ScraperLog } from '@/types';
import { requestTotpCode, markInvalidAttempt } from './totpChallenge';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_BASE}/api/v1`,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 6000,
});

// Add auth token to every request if available
apiClient.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

// Response error handling.
// Deux chemins spéciaux avant l'erreur générique :
//   1. 403 TOTP_REQUIRED → on pop le modal de challenge, on attend le code,
//      on rejoue la requête avec `x-totp-code` en header.
//   2. 401 TOTP_INVALID (le user a tapé un code faux) → on re-pop le modal
//      avec un flag "essaye encore" sans casser la chaîne.
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error)) {
      const cfg = error.config as (InternalAxiosRequestConfig & { __totpRetry?: boolean }) | undefined;
      const body = (error.response?.data ?? {}) as { error?: string; reason?: 'unknown_ip' | 'sensitive_action' };

      if (error.response?.status === 403 && body.error === 'TOTP_REQUIRED' && cfg && !cfg.__totpRetry) {
        try {
          const code = await requestTotpCode(body.reason ?? 'unknown_ip');
          cfg.__totpRetry = true;
          cfg.headers = cfg.headers ?? {};
          (cfg.headers as Record<string, string>)['x-totp-code'] = code;
          return apiClient.request(cfg);
        } catch {
          return Promise.reject(new Error('2FA required'));
        }
      }

      if (error.response?.status === 401 && body.error === 'TOTP_INVALID' && cfg) {
        // Le code était faux → rouvre le modal (sans casser le resolver
        // courant si déjà en cours) pour que le user retape.
        markInvalidAttempt();
        try {
          const code = await requestTotpCode();
          cfg.headers = cfg.headers ?? {};
          (cfg.headers as Record<string, string>)['x-totp-code'] = code;
          return apiClient.request(cfg);
        } catch {
          return Promise.reject(new Error('2FA code invalide'));
        }
      }

      const message = body.error || error.message || 'Request failed';
      return Promise.reject(new Error(message));
    }
    return Promise.reject(error);
  }
);

// Matches
export async function getMatches(params?: {
  status?: string;
  tournamentId?: string;
  limit?: number;
  offset?: number;
  hours?: number;
}): Promise<PaginatedResponse<Match>> {
  const res = await apiClient.get('/matches', { params });
  return res.data as PaginatedResponse<Match>;
}

export async function getMatch(id: string): Promise<ApiResponse<Match>> {
  const res = await apiClient.get(`/matches/${id}`);
  return res.data as ApiResponse<Match>;
}

export async function getMatchH2H(id: string): Promise<ApiResponse<{
  matches: Match[];
  summary: { total: number; player1Wins: number; player2Wins: number };
}>> {
  const res = await apiClient.get(`/matches/${id}/h2h`);
  return res.data;
}

// Players
export async function getPlayers(params?: { search?: string; limit?: number; offset?: number }): Promise<PaginatedResponse<Player>> {
  const res = await apiClient.get('/players', { params });
  return res.data as PaginatedResponse<Player>;
}

export async function getPlayer(id: string): Promise<ApiResponse<Player>> {
  const res = await apiClient.get(`/players/${id}`);
  return res.data as ApiResponse<Player>;
}

// Tournaments
export async function getTournaments(params?: {
  active?: boolean;
  tier?: string;
  limit?: number;
}): Promise<PaginatedResponse<Tournament>> {
  const res = await apiClient.get('/tournaments', { params });
  return res.data as PaginatedResponse<Tournament>;
}

export async function getTournament(id: string): Promise<ApiResponse<Tournament & {
  matches: { upcoming: Match[]; live: Match[]; completed: Match[]; all: Match[] };
  participantCount: number;
}>> {
  const res = await apiClient.get(`/tournaments/${id}`);
  return res.data;
}

// Bets
export async function placeBet(matchId: string, amount: number, selectedPlayer: 0 | 1 | 2, expectedOdds?: number): Promise<ApiResponse<Bet>> {
  const body: Record<string, unknown> = { matchId, amount, selectedPlayer };
  if (expectedOdds !== undefined) body.expectedOdds = expectedOdds;
  const res = await apiClient.post('/bets', body);
  return res.data as ApiResponse<Bet>;
}

export async function getMyBets(params?: {
  status?: string;
  limit?: number;
  offset?: number;
}): Promise<PaginatedResponse<Bet> & { stats: UserStats }> {
  const res = await apiClient.get('/bets/my', { params });
  return res.data;
}

export async function getMatchBets(matchId: string): Promise<ApiResponse<{
  matchId: string;
  player1: { volume: number; count: number };
  player2: { volume: number; count: number };
  total: number;
  pct1: number;
  pct2: number;
}>> {
  const res = await apiClient.get(`/bets/match/${matchId}`);
  return res.data;
}

// Users
export async function getUserProfile(): Promise<ApiResponse<User>> {
  const res = await apiClient.get('/users/me');
  return res.data as ApiResponse<User>;
}

// Simple in-memory cache for leaderboard (changes slowly, expensive to fetch)
let lbCache: { data: ApiResponse<LeaderboardEntry[]>; ts: number } | null = null;
const LB_CACHE_TTL = 60_000; // 1 minute

export async function getLeaderboard(): Promise<ApiResponse<LeaderboardEntry[]>> {
  if (lbCache && Date.now() - lbCache.ts < LB_CACHE_TTL) return lbCache.data;
  const res = await apiClient.get('/users/leaderboard');
  const data = res.data as ApiResponse<LeaderboardEntry[]>;
  lbCache = { data, ts: Date.now() };
  return data;
}

export async function getWeeklyLeaderboard(): Promise<ApiResponse<WeeklyLeaderboardEntry[]> & { weekStart: string }> {
  const res = await apiClient.get('/users/leaderboard/weekly');
  return res.data;
}

export async function loginWithProvider(data: {
  provider: 'google' | 'discord';
  providerId: string;
  email: string;
  username: string;
  avatar?: string;
}): Promise<ApiResponse<{ token: string; user: User }>> {
  const res = await apiClient.post('/users/auth/login', data);
  return res.data as ApiResponse<{ token: string; user: User }>;
}

// Admin
export async function getFlaggedMatches(): Promise<ApiResponse<Match[]>> {
  const res = await apiClient.get('/admin/matches/flagged');
  return res.data as ApiResponse<Match[]>;
}

export async function setMatchResult(matchId: string, data: {
  winnerId: string;
  resultScore: string;
  clearFlag?: boolean;
}): Promise<ApiResponse<void>> {
  const res = await apiClient.post(`/admin/matches/${matchId}/result`, data);
  return res.data as ApiResponse<void>;
}

export async function getScraperLogs(params?: { limit?: number; source?: string }): Promise<ApiResponse<ScraperLog[]>> {
  const res = await apiClient.get('/admin/scrapers/logs', { params });
  return res.data as ApiResponse<ScraperLog[]>;
}

export async function cancelMatch(matchId: string): Promise<ApiResponse<void>> {
  const res = await apiClient.post(`/admin/matches/${matchId}/cancel`);
  return res.data as ApiResponse<void>;
}

export async function deleteMatch(matchId: string): Promise<ApiResponse<void>> {
  const res = await apiClient.delete(`/admin/matches/${matchId}`);
  return res.data as ApiResponse<void>;
}

export async function triggerScraper(source: 'tournaments' | 'aoe4world' | 'enrich'): Promise<ApiResponse<void>> {
  const res = await apiClient.post('/admin/scrapers/run', { source });
  return res.data as ApiResponse<void>;
}

export async function getAdminUsers(params?: { limit?: number; offset?: number; search?: string }): Promise<PaginatedResponse<User>> {
  const res = await apiClient.get('/admin/users', { params });
  return res.data as PaginatedResponse<User>;
}

export async function banUser(userId: string, banned: boolean, reason?: string): Promise<ApiResponse<void>> {
  const res = await apiClient.post(`/admin/users/${userId}/ban`, { banned, reason });
  return res.data as ApiResponse<void>;
}

// Affiliate
export async function validateAffiliateCode(code: string): Promise<{ valid: boolean; bonusPct?: number; code?: string; error?: string }> {
  const res = await apiClient.get(`/affiliate/validate/${encodeURIComponent(code)}`);
  return res.data;
}

export async function getMyAffiliate(): Promise<ApiResponse<{
  code: string;
  commissionRate: number;
  totalEarnings: number;
  available: number;
  totalReferrals: number;
  activeReferrals: number;
  totalDeposited: number;
  referrals: Array<{ id: string; isActive: boolean; totalDeposited: number; commission: number; user: { username: string; avatar?: string } | null }>;
} | null>> {
  const res = await apiClient.get('/affiliate/me');
  return res.data;
}

export async function claimAffiliateEarnings(): Promise<ApiResponse<{ claimed: number }>> {
  const res = await apiClient.post('/affiliate/claim');
  return res.data as ApiResponse<{ claimed: number }>;
}

export async function adminCreateAffiliateCode(userId: string, customCode?: string): Promise<ApiResponse<{ id: string; code: string; commissionRate: number }>> {
  const res = await apiClient.post('/affiliate/admin/create', { userId, customCode });
  return res.data as ApiResponse<{ id: string; code: string; commissionRate: number }>;
}

export async function adminListAffiliateCodes(): Promise<ApiResponse<Array<{
  id: string; code: string; commissionRate: number; totalEarnings: number;
  available: number; totalReferrals: number; activeReferrals: number; totalDeposited: number;
  user: { id: string; username: string; avatar?: string } | null;
}>>> {
  const res = await apiClient.get('/affiliate/admin/list');
  return res.data;
}

// Coinflip
export const getActiveCoinFlips = () => apiClient.get('/coinflip');
export const createCoinFlip = (amount: number, side: string) => apiClient.post('/coinflip/create', { amount, side });
export const joinCoinFlip = (id: string) => apiClient.post(`/coinflip/${id}/join`);
export const cancelCoinFlip = (id: string) => apiClient.post(`/coinflip/${id}/cancel`);

export { apiClient };
export default apiClient;
