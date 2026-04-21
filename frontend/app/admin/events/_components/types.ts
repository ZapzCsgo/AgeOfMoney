export type RuleType =
  | 'DAU_DROP'
  | 'DEPOSITS_NOT_ACTIVATED'
  | 'VIP_INACTIVE'
  | 'S_TIER_INCOMING'
  | 'AFFILIATE_SURGE'
  | 'LOW_JACKPOT'
  | 'VOLUME_RECORD'
  | 'BIG_WINNER';

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
  DAU_DROP:               "DAU en berne",
  DEPOSITS_NOT_ACTIVATED: "Deposits sans activation",
  VIP_INACTIVE:           "VIP inactif",
  S_TIER_INCOMING:        "Tournoi S-tier",
  AFFILIATE_SURGE:        "Affiliate en fusion",
  LOW_JACKPOT:            "Jackpot en sommeil",
  VOLUME_RECORD:          "Record de volume",
  BIG_WINNER:             "Big winner",
};

export const RULE_CATEGORY: Record<RuleType, 'engagement' | 'tournament' | 'affiliate' | 'milestone' | 'user'> = {
  DAU_DROP:               'engagement',
  DEPOSITS_NOT_ACTIVATED: 'engagement',
  VIP_INACTIVE:           'user',
  S_TIER_INCOMING:        'tournament',
  AFFILIATE_SURGE:        'affiliate',
  LOW_JACKPOT:            'engagement',
  VOLUME_RECORD:          'milestone',
  BIG_WINNER:             'user',
};

export const CATEGORY_LABELS: Record<typeof RULE_CATEGORY[RuleType], string> = {
  engagement: 'ENGAGEMENT',
  tournament: 'TOURNAMENT',
  affiliate:  'AFFILIATE',
  milestone:  'MILESTONE',
  user:       'USER',
};

export const PRIORITY_STYLE: Record<Priority, { border: string; badgeBg: string; badgeColor: string; accent: string }> = {
  HIGH: {
    border:     'rgba(239,68,68,0.45)',
    badgeBg:    'rgba(239,68,68,0.15)',
    badgeColor: '#f87171',
    accent:     '#ef4444',
  },
  MEDIUM: {
    border:     'rgba(255,197,66,0.45)',
    badgeBg:    'rgba(255,197,66,0.15)',
    badgeColor: '#ffd97a',
    accent:     '#ffc542',
  },
  LOW: {
    border:     'rgba(107,100,136,0.35)',
    badgeBg:    'rgba(107,100,136,0.15)',
    badgeColor: '#9990b8',
    accent:     '#6b6488',
  },
};
