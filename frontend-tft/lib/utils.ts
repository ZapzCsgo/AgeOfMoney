import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatCoins(n: number | string): string {
  const num = typeof n === 'string' ? parseFloat(n) : n;
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(isFinite(num) ? num : 0);
}

/**
 * Parse a coin amount typed by the user. Accepts "1,2" (FR), "1.2" (intl),
 * and strips spaces / non-numeric noise. Returns a safe finite number ;
 * callers should still validate the range against their business limits.
 */
export function parseCoinAmount(raw: string | number): number {
  if (typeof raw === 'number') return isFinite(raw) ? raw : 0;
  const cleaned = String(raw).replace(/\s/g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const n = parseFloat(cleaned);
  return isFinite(n) ? n : 0;
}
