// Enums
export type MatchStatus = 'UPCOMING' | 'LIVE' | 'COMPLETED' | 'CANCELLED' | 'POSTPONED';
export type BetStatus = 'PENDING' | 'WON' | 'LOST' | 'REFUNDED' | 'CANCELLED';
export type TournamentTier = 'S' | 'A' | 'B' | 'C';
export type TransactionType = 'deposit' | 'withdrawal' | 'bet_win' | 'bet_loss' | 'refund' | 'bonus';
export type TransactionStatus = 'pending' | 'completed' | 'failed';
export type ChatLevel = number;  // numeric level (1, 2, 3...) computed from totalWagered

// Models
export interface User {
  id: string;
  username: string;
  email: string;
  steamId?: string | null;
  avatar?: string | null;
  coins: number;
  isAdmin: boolean;
  isBanned?: boolean;
  provider?: string;
  createdAt: string;
  lastActiveAt?: string;
  _count?: { bets: number };
}

export interface Player {
  id: string;
  name: string;
  liquipediaSlug: string;
  aoe4worldId?: string | null;
  elo: number;
  winrate: number;
  country?: string | null;
  avatarUrl?: string | null;
  lastMatchAt?: string | null;
  lastUpdatedAt?: string;
  createdAt?: string;
}

export interface PlayerWithStats extends Player {
  stats?: {
    totalMatches: number;
    wins: number;
    losses: number;
    tournamentWins: number;
    winrateCalculated: number;
  };
  recentMatches?: Match[];
}

export interface Tournament {
  id: string;
  name: string;
  tier: TournamentTier;
  prizePool?: string | null;
  startDate: string;
  endDate?: string | null;
  liquipediaUrl: string;
  logoUrl?: string | null;
  isActive: boolean;
  createdAt: string;
  _count?: { matches: number };
}

export interface BoResult {
  boNumber: number;
  winnerId?: string | null;
  p1Civ?: string | null;
  p2Civ?: string | null;
  map?: string | null;
  duration?: number | null;
}

export interface Match {
  id: string;
  player1Id: string;
  player2Id: string;
  player1: Player;
  player2: Player;
  tournamentId?: string | null;
  tournament?: (Tournament & { twitchChannel?: string | null }) | null;
  format: string;
  scheduledAt: string;
  status: MatchStatus;
  resultScore?: string | null;
  winnerId?: string | null;
  odds1: number;
  odds2: number;
  betsClosedAt?: string | null;
  betsOpen?: boolean;
  currentBoNumber?: number;
  p1Score?: number;
  p2Score?: number;
  p1Civ?: string | null;
  p2Civ?: string | null;
  twitchChannel?: string | null;
  liquipediaUrl?: string | null;
  verificationFlag?: boolean;
  boResults?: BoResult[];
  createdAt: string;
  updatedAt: string;
  betVolume?: BetVolume;
  recentForm?: {
    player1: RecentMatchResult[];
    player2: RecentMatchResult[];
  };
}

export interface BetVolume {
  player1: number;
  player2: number;
  total: number;
  pct1: number;
  pct2: number;
  count1?: number;
  count2?: number;
}

export interface RecentMatchResult {
  id: string;
  player1Id: string;
  player2Id: string;
  winnerId?: string | null;
  resultScore?: string | null;
  scheduledAt: string;
  player1: { name: string };
  player2: { name: string };
}

export interface Bet {
  id: string;
  userId: string;
  matchId: string;
  match: Match;
  amount: number;
  oddsAtBet: number;
  selectedPlayer: 1 | 2;
  status: BetStatus;
  payout?: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  amount: number;
  realAmount?: number | null;  // in cents (€)
  coins: number;
  stripeSessionId?: string | null;
  status: TransactionStatus;
  createdAt: string;
}

export interface CoinPackage {
  id: string;
  coins: number;
  baseCoins: number;
  bonusCoins: number;
  priceEur: number;
  label: string;
  popular?: boolean;
  bestValue?: boolean;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  avatar?: string | null;
  level?: number;
  tier?: string;
  coins?: number;
  message: string;
  isAdmin?: boolean;
  timestamp: Date | string;
}

export interface ScraperLog {
  id: string;
  source: string;
  status: 'success' | 'error' | 'partial';
  matchesFound: number;
  error?: string | null;
  duration?: number | null;
  createdAt: string;
}

// API response wrappers
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}

// Socket event types
export interface SocketBetPlaced {
  playerIndex: 1 | 2;
  amount: number;
  totalVolume: BetVolume;
}

export interface SocketOddsUpdate {
  matchId: string;
  odds1: number;
  odds2: number;
  timestamp: string;
}

export interface SocketMatchStatus {
  matchId: string;
  status: MatchStatus;
}

export interface SocketChatMessage extends ChatMessage {
  isAdmin?: boolean;
}

// Leaderboard
export interface LeaderboardEntry {
  id: string;
  username: string;
  avatar?: string | null;
  coins: number;
  totalWagered: number;
  createdAt: string;
  _count?: { bets: number };
}

export interface WeeklyLeaderboardEntry {
  rank: number;
  user: LeaderboardEntry;
  weeklyWinnings: number;
  weeklyBets: number;
}

// User stats
export interface UserStats {
  totalBets: number;
  wonBets: number;
  lostBets: number;
  pendingBets: number;
  totalWagered: number;
  totalPayout: number;
  netProfit: number;
  roi: number;
  winrate: number;
  bestBet: {
    amount: number;
    odds: number;
    payout: number;
    profit: number;
  } | null;
}

// NextAuth session extension
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      steamId?: string | null;
      coins: number;
      isAdmin: boolean;
      accessToken: string;
    };
  }
}

// Mock data helpers
export interface MockMatch extends Omit<Match, 'player1' | 'player2' | 'tournament'> {
  player1: Player;
  player2: Player;
  tournament: Tournament;
}
