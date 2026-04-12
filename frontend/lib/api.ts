import axios, { AxiosInstance } from 'axios';
import { Match, Player, Tournament, Bet, User, LeaderboardEntry, WeeklyLeaderboardEntry, PaginatedResponse, ApiResponse, UserStats, ScraperLog } from '@/types';

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
  timeout: 10000,
});

// Add auth token to every request if available
apiClient.interceptors.request.use((config) => {
  if (authToken) {
    config.headers.Authorization = `Bearer ${authToken}`;
  }
  return config;
});

// Response error handling
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (axios.isAxiosError(error)) {
      const message = error.response?.data?.error || error.message || 'Request failed';
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
export async function placeBet(matchId: string, amount: number, selectedPlayer: 0 | 1 | 2): Promise<ApiResponse<Bet>> {
  const res = await apiClient.post('/bets', { matchId, amount, selectedPlayer });
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

export async function getLeaderboard(): Promise<ApiResponse<LeaderboardEntry[]>> {
  const res = await apiClient.get('/users/leaderboard');
  return res.data as ApiResponse<LeaderboardEntry[]>;
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

export { apiClient };
export default apiClient;
