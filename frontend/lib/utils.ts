import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format, differenceInSeconds, differenceInMinutes, differenceInHours } from 'date-fns';
import { fr } from 'date-fns/locale';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCoins(amount: number): string {
  return new Intl.NumberFormat('fr-FR').format(amount) + ' ⚜';
}

export function formatOdds(odds: number): string {
  return odds.toFixed(2);
}

export function getPotentialGain(amount: number, odds: number): number {
  return Math.floor(amount * odds);
}

export function getNetGain(amount: number, odds: number): number {
  return Math.floor(amount * odds) - amount;
}

export function formatCountdown(targetDate: Date | string): string {
  const target = typeof targetDate === 'string' ? new Date(targetDate) : targetDate;
  const now = new Date();
  const diffSeconds = differenceInSeconds(target, now);

  if (diffSeconds <= 0) return 'Commencé';

  const days = Math.floor(diffSeconds / 86400);
  const hours = Math.floor((diffSeconds % 86400) / 3600);
  const minutes = Math.floor((diffSeconds % 3600) / 60);
  const seconds = diffSeconds % 60;

  if (days > 0) {
    return `${days}j ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}min`;
  } else if (minutes > 0) {
    return `${minutes}min ${seconds}s`;
  } else {
    return `${seconds}s`;
  }
}

export function formatRelativeTime(dateStr: string): string {
  return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: fr });
}

export function formatDateTime(dateStr: string): string {
  return format(new Date(dateStr), 'dd/MM/yyyy HH:mm');
}

export function formatDate(dateStr: string): string {
  return format(new Date(dateStr), 'dd/MM/yyyy');
}

export function getTierColor(tier: string): string {
  switch (tier) {
    case 'S': return '#e8c547';
    case 'A': return '#d4d4d4';
    case 'B': return '#d4842a';
    case 'C': return '#888888';
    default: return '#888888';
  }
}

export function getTierBadgeClass(tier: string): string {
  switch (tier) {
    case 'S': return 'aoe-badge-s';
    case 'A': return 'aoe-badge-a';
    case 'B': return 'aoe-badge-b';
    case 'C': return 'aoe-badge-c';
    default: return 'aoe-badge-c';
  }
}

export function getMatchStatusClass(status: string): string {
  switch (status) {
    case 'LIVE': return 'aoe-badge-live';
    case 'UPCOMING': return 'aoe-badge-upcoming';
    case 'COMPLETED': return 'aoe-badge-completed';
    default: return 'aoe-badge';
  }
}

export function getBetStatusColor(status: string): string {
  switch (status) {
    case 'WON': return 'text-emerald-400';
    case 'LOST': return 'text-red-500';
    case 'PENDING': return 'text-yellow-500';
    case 'REFUNDED': return 'text-gray-400';
    case 'CANCELLED': return 'text-gray-500';
    default: return 'text-gray-400';
  }
}

export function getBetStatusLabel(status: string): string {
  switch (status) {
    case 'WON': return 'Gagné';
    case 'LOST': return 'Perdu';
    case 'PENDING': return 'En cours';
    case 'REFUNDED': return 'Remboursé';
    case 'CANCELLED': return 'Annulé';
    default: return status;
  }
}

export function getCountryFlag(countryCode: string | null | undefined): string {
  if (!countryCode) return '';
  const code = countryCode.toUpperCase();
  // Convert country code to regional indicator emoji
  const offset = 0x1F1E0 - 0x41;
  const chars = code.split('').map(char => String.fromCodePoint(char.charCodeAt(0) + offset));
  return chars.join('');
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - 3) + '...';
}

export function calculateROI(totalWagered: number, totalPayout: number): number {
  if (totalWagered === 0) return 0;
  return ((totalPayout - totalWagered) / totalWagered) * 100;
}

export function isMatchBettable(
  status: string,
  betsClosedAt: string | null | undefined,
  scheduledAt: string,
  betsOpen?: boolean
): boolean {
  if (status !== 'UPCOMING' && status !== 'LIVE') return false;
  if (betsClosedAt && new Date() > new Date(betsClosedAt)) return false;
  // betsOpen=false means a BO is in progress — bets temporarily closed
  if (betsOpen === false) return false;
  // For LIVE matches, betsOpen controls access — no time cutoff needed
  if (status === 'LIVE') return true;
  // For UPCOMING, close betting 5 min before scheduled start
  const fiveMinBefore = new Date(new Date(scheduledAt).getTime() - 5 * 60 * 1000);
  if (new Date() > fiveMinBefore) return false;
  return true;
}
