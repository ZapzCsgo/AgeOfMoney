export type RuleType =
  | 'DAU_DROP'
  | 'DEPOSITS_NOT_ACTIVATED'
  | 'VIP_INACTIVE'
  | 'S_TIER_INCOMING'
  | 'AFFILIATE_SURGE'
  | 'LOW_JACKPOT'
  | 'VOLUME_RECORD'
  | 'BIG_WINNER'
  | 'RAIN_OPPORTUNITY';

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';
export type Status = 'NEW' | 'SEEN' | 'ACTED' | 'DISMISSED';

export interface EventSuggestion {
  id: string;
  ruleType: RuleType;
  subjectKey: string;
  priority: Priority;
  title: string;
  contextData: Record<string, unknown>;
  suggestedAction: string;
  estimatedBudget: string | null;
  estimatedImpact: string | null;
  status: Status;
  dismissedUntil: string | null;
  actedAt: string | null;
  actedNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export const RULE_LABELS: Record<RuleType, string> = {
  DAU_DROP:               'DAU en berne',
  DEPOSITS_NOT_ACTIVATED: 'Deposits sans activation',
  VIP_INACTIVE:           'VIP inactif',
  S_TIER_INCOMING:        'Tournoi S-tier',
  AFFILIATE_SURGE:        'Affiliate en fusion',
  LOW_JACKPOT:            'Jackpot en sommeil',
  VOLUME_RECORD:          'Record de volume',
  BIG_WINNER:             'Big winner',
  RAIN_OPPORTUNITY:       'Rain opportunity',
};

export type RuleCategory = 'engagement' | 'tournament' | 'affiliate' | 'milestone' | 'user' | 'rain';

export const RULE_CATEGORY: Record<RuleType, RuleCategory> = {
  DAU_DROP:               'engagement',
  DEPOSITS_NOT_ACTIVATED: 'engagement',
  VIP_INACTIVE:           'user',
  S_TIER_INCOMING:        'tournament',
  AFFILIATE_SURGE:        'affiliate',
  LOW_JACKPOT:            'engagement',
  VOLUME_RECORD:          'milestone',
  BIG_WINNER:             'user',
  RAIN_OPPORTUNITY:       'rain',
};

export const CATEGORY_LABELS: Record<RuleCategory, string> = {
  engagement: 'ENGAGEMENT',
  tournament: 'TOURNAMENT',
  affiliate:  'AFFILIATE',
  milestone:  'MILESTONE',
  user:       'USER',
  rain:       'RAIN',
};

/**
 * Color tokens map to the TFT palette (Tailwind theme `tft-*`).
 * HIGH leans into the danger red, MEDIUM borrows the arcane purple (primary
 * brand attention color), LOW stays in muted text territory.
 */
export const PRIORITY_STYLE: Record<Priority, { border: string; badgeBg: string; badgeColor: string; accent: string }> = {
  HIGH: {
    border:     'rgba(239,68,68,0.45)',
    badgeBg:    'rgba(239,68,68,0.15)',
    badgeColor: '#f87171',
    accent:     '#ef4444',
  },
  MEDIUM: {
    border:     'rgba(167,139,250,0.45)',
    badgeBg:    'rgba(167,139,250,0.15)',
    badgeColor: '#a78bfa',
    accent:     '#7c3aed',
  },
  LOW: {
    border:     'rgba(100,116,139,0.35)',
    badgeBg:    'rgba(100,116,139,0.15)',
    badgeColor: '#94a3b8',
    accent:     '#64748b',
  },
};
