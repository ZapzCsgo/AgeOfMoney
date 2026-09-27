// Dev-only correctness check for the roulette wheel's landing-index math.
// Re-implements the exact landIdx search used in app/roulette/page.tsx
// (animateSpin() and applyPendingResult()) and asserts, for every possible
// server result, that the tile the wheel lands on carries that exact number.
//
// Run with: node scripts/audit-roulette-index.mjs

const ZONES = {
  KNIGHTS: {}, EMPEROR: {}, ARCHERS: {},
};

const BASE_PATTERN = [
  { zone: 'KNIGHTS', num: 1 },  { zone: 'ARCHERS', num: 9 },  { zone: 'KNIGHTS', num: 2 },
  { zone: 'ARCHERS', num: 10 }, { zone: 'KNIGHTS', num: 3 },  { zone: 'ARCHERS', num: 11 },
  { zone: 'KNIGHTS', num: 4 },  { zone: 'EMPEROR', num: 8 },  { zone: 'ARCHERS', num: 12 },
  { zone: 'KNIGHTS', num: 5 },  { zone: 'ARCHERS', num: 13 }, { zone: 'KNIGHTS', num: 6 },
  { zone: 'ARCHERS', num: 14 }, { zone: 'KNIGHTS', num: 7 },  { zone: 'ARCHERS', num: 15 },
];
const REPEATS = 12;

function buildPrizeList() {
  const items = [];
  for (let r = 0; r < REPEATS; r++) {
    for (let i = 0; i < BASE_PATTERN.length; i++) {
      const slot = BASE_PATTERN[i];
      items.push({ id: `r${r}-${i}-${slot.num}`, zone: slot.zone, num: slot.num });
    }
  }
  return items;
}

// Exact copy of the search loop in animateSpin()/applyPendingResult().
function computeLandIndex(prizeList, wz, resultNum) {
  const target = Math.floor(prizeList.length * 0.78);
  let landIdx = target;
  let iterationsUsed = null;
  for (let i = 0; i < 60; i++) {
    const idx = (target + i) % prizeList.length;
    const slot = prizeList[idx];
    if (resultNum != null) {
      if (slot.num === resultNum) { landIdx = idx; iterationsUsed = i; break; }
    } else if (slot.zone === wz) {
      landIdx = idx; iterationsUsed = i; break;
    }
  }
  return { landIdx, iterationsUsed };
}

function zoneFromResult(n) {
  if (n === 8) return 'EMPEROR';
  return n <= 7 ? 'KNIGHTS' : 'ARCHERS';
}

const prizeList = buildPrizeList();
console.log(`prizeList length: ${prizeList.length} (REPEATS=${REPEATS} x ${BASE_PATTERN.length} slots)`);

let failures = 0;
let checked = 0;

// 1. Every possible server result (1-15), searched from every possible
//    array-rotation offset (simulates "the target 78% landing point could
//    fall anywhere relative to where a given number sits").
for (let result = 1; result <= 15; result++) {
  for (let rotation = 0; rotation < prizeList.length; rotation++) {
    // Rotate the list to simulate the search starting at different points —
    // equivalent to re-deriving target for a differently-sized list, but
    // cheaper: we just re-run the same fixed-ratio search against a rotated
    // copy so every possible relative offset between `target` and the
    // matching slot gets exercised at least once.
    const rotated = [...prizeList.slice(rotation), ...prizeList.slice(0, rotation)];
    const { landIdx, iterationsUsed } = computeLandIndex(rotated, zoneFromResult(result), result);
    checked++;
    if (iterationsUsed === null) {
      failures++;
      console.error(`FAIL: no match found at all for result=${result}, rotation=${rotation}`);
      continue;
    }
    if (rotated[landIdx].num !== result) {
      failures++;
      console.error(`FAIL: landed on num=${rotated[landIdx].num}, expected ${result} (rotation=${rotation}, iterations=${iterationsUsed})`);
    }
    if (iterationsUsed >= 60) {
      failures++;
      console.error(`FAIL: search exceeded the 60-iteration cap for result=${result}, rotation=${rotation}`);
    }
  }
}

// 2. Zone-only fallback path (resultNum undefined) — every zone must resolve
//    to a slot of that zone.
for (const zone of ['KNIGHTS', 'EMPEROR', 'ARCHERS']) {
  const { landIdx, iterationsUsed } = computeLandIndex(prizeList, zone, undefined);
  checked++;
  if (iterationsUsed === null || prizeList[landIdx].zone !== zone) {
    failures++;
    console.error(`FAIL: zone-only fallback landed on wrong zone for ${zone}`);
  }
}

console.log(`\nChecked ${checked} cases, ${failures} failure(s).`);
if (failures > 0) {
  console.error('AUDIT RESULT: landing-index math has bugs — see FAIL lines above.');
  process.exit(1);
} else {
  console.log('AUDIT RESULT: landing-index math is correct for every result 1-15 across all rotations — the tile the wheel targets always carries the exact server-provided number.');
  console.log('NOTE: this only checks the array-index math. It does NOT check whether that');
  console.log('index is actually visible on screen at a given viewport width — see the');
  console.log('manual DOM measurement in the audit report for the confirmed mobile-clipping bug.');
}
