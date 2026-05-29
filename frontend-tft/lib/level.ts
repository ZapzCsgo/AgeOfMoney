/**
 * XP & level computation — shares the same thresholds as AgeOfMoney so a
 * user who plays on both surfaces has a single coherent progression. The
 * backend's socket layer already computes level + tier from totalWagered ;
 * this is just the client-side mirror used by chat, profile header, and
 * any UI that displays a level without doing a round-trip.
 *
 * 1 coin wagered = 420 XP. 20 levels, exponential progression.
 */

const XP_THRESHOLDS = [
  0,              // Lv 1
  420,            // Lv 2  (1 coin)
  4_200,          // Lv 3  (10 coins)
  21_000,         // Lv 4  (50 coins)
  63_000,         // Lv 5  (150 coins)
  168_000,        // Lv 6  (400 coins)
  420_000,        // Lv 7  (1k coins)
  1_050_000,      // Lv 8  (2.5k coins)
  2_100_000,      // Lv 9  (5k coins)
  4_200_000,      // Lv 10 (10k coins)
  8_400_000,      // Lv 11 (20k coins)
  21_000_000,     // Lv 12 (50k coins)
  42_000_000,     // Lv 13 (100k coins)
  84_000_000,     // Lv 14 (200k coins)
  210_000_000,    // Lv 15 (500k coins)
  420_000_000,    // Lv 16 (1M coins)
  840_000_000,    // Lv 17 (2M coins)
  1_680_000_000,  // Lv 18 (4M coins)
  3_360_000_000,  // Lv 19 (8M coins)
  8_400_000_000,  // Lv 20 (20M coins)
];

export function computeLevel(totalWagered: number): { level: number; pct: number } {
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

export function levelTier(level: number): 'legend' | 'diamond' | 'platinum' | 'gold' | 'silver' | 'bronze' {
  if (level >= 51) return 'legend';
  if (level >= 41) return 'diamond';
  if (level >= 31) return 'platinum';
  if (level >= 21) return 'gold';
  if (level >= 11) return 'silver';
  return 'bronze';
}

/**
 * Tier color on the TFT palette. Backend uses the same tier strings, but
 * AoM's palette skews gold ; we adapt to TFT's purple-anchored system so
 * badges match the rest of the site visually.
 */
export function tierColor(tier: string): string {
  switch (tier) {
    case 'legend':   return '#a855f7'; // bright purple — top tier
    case 'diamond':  return '#22d3ee'; // cyan accent (rare)
    case 'platinum': return '#38bdf8';
    case 'gold':     return '#fcd34d'; // TFT gold for big money / rank gold
    case 'silver':   return '#94a3b8';
    default:         return '#78716c'; // bronze
  }
}
