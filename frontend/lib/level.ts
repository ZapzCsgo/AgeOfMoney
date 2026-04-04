// 1 coin wagered = 420 XP
const XP_THRESHOLDS = [
  0, 420, 4_200, 21_000, 63_000, 168_000, 420_000,
  1_050_000, 2_100_000, 4_200_000, 8_400_000, 21_000_000,
  42_000_000, 84_000_000, 210_000_000, 420_000_000, 840_000_000,
  1_680_000_000, 3_360_000_000, 8_400_000_000,
];

export function computeLevel(totalWagered: number): number {
  const xp = Math.max(0, totalWagered) * 420;
  let level = 1;
  for (let i = 1; i < XP_THRESHOLDS.length; i++) {
    if (xp >= XP_THRESHOLDS[i]) level = i + 1;
    else break;
  }
  return Math.min(level, 20);
}

export function levelTier(level: number): string {
  if (level >= 51) return 'legend';
  if (level >= 41) return 'diamond';
  if (level >= 31) return 'platinum';
  if (level >= 21) return 'gold';
  if (level >= 11) return 'silver';
  return 'bronze';
}
