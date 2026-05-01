# Unused features audit — 2026-05-02

Inventory of features that EXIST in the data layer but are NOT (yet) consumed
by `oddsEngine.ts`. Purpose : identify cheap signal sources for variants v37+
without requiring schema work or external data scrapes.

## In-DB features available right now

### Player table
| Field | Coverage | Used by engine ? | Variant idea |
|-------|----------|------------------|--------------|
| `country` | ~95 % | ❌ | "home crowd" — needs match region (not schemd) → skip |
| `elo` | 100 % (default 1000) | ❌ | bypassed in favor of Glicko ratings |
| `peakElo` | sparse | ❌ | "career peak vs current form" indicator |
| `currentStreak` | 100 % | ❌ | direct streak signal (no need to recompute) |
| `totalGames` | 100 % | ❌ | confidence weighting — already covered by PMR count |
| `lastMatchAt` | 100 % | ✅ | used for rust factor |

### PlayerMatchRecord table
| Field | Coverage | Used by engine ? | Variant idea |
|-------|----------|------------------|--------------|
| `format` | sparse (~30 %) | ❌ | per-format winrate (BO3 vs BO5 strength) |
| `won` | 100 % | ✅ | base signal |
| `tier` | 100 % | ✅ | tier weighting |
| `score` | sparse (~50 %) | ✅ (form factor) | already used for dominance bonus |
| `matchDate` | 100 % | ✅ | time decay |
| `confidence` | 100 % | ✅ | H2H weighting |

### BoResult table — **EMPTY** (0 rows)
- `p1Civ`, `p2Civ`, `map`, `aoe4GameId` all present in schema.
- **No data populated**. Civ × map variants need a data-ingest step
  (Liquipedia per-game scraping or aoe4world.com per-game replay parse).
- Effort estimated 4-6 h, out of scope tonight.

### Match table
| Field | Coverage | Used by engine ? | Variant idea |
|-------|----------|------------------|--------------|
| `format` | 100 % | ✅ | series math |
| `scheduledAt` | 100 % | ✅ | recency in form |
| `p1Civ`, `p2Civ` | ~0 % | ❌ | empty |

### Computable / derivable features
| Derived | Source | Variant idea |
|---------|--------|--------------|
| Hour-of-day bucket | `Match.scheduledAt` | "prime-time vs casual" performance |
| Days-between-matches | `Player.lastMatchAt` chain | rest curve (already in rust factor) |
| Variance of last N | PMR `won` series | consistency score |
| Streak (computed) | PMR `won` chronological | duplicate of `currentStreak` but per-game |
| Patch-era split | hardcoded patch dates | weight pre/post-patch separately |

## What this means for variants v37-v46

| # | Variant | Feasible tonight ? | Why |
|---|---------|---------------------|-----|
| v37 | tier-context-boost | ✅ pure hyperparam | bumps existing `tierCtxWeight` |
| v38 | streak-decay-aggressive | ✅ pure hyperparam | extends existing `formStreakBonus` |
| v39 | time-of-day | ⚠️ new compute | doable but requires extending tunable-engine |
| v40 | opp-strength-stretch-extreme | ✅ pure hyperparam | bumps existing opp strength a/b |
| v41 | recent-patch-reset | ⚠️ new hyperparam | needs `patchResetDate` field |
| v42 | consistency-score | ⚠️ new compute | needs variance helper |
| v43 | bo-format-specific | ⚠️ new compute | needs format-conditional winrate |
| v44 | combo-h2h-streak-tier | ✅ pure hyperparam | combines 3 existing axes |
| v45 | bayes-weak-h2h-priority | ✅ pure hyperparam | combines 2 existing axes |
| v46 | ensemble-voting | ⚠️ new orchestrator | calls top-N variants + averages probs |

**Plan** : implement all 10. Pure-hyperparam ones land in `variants.ts` ;
medium ones extend `tunable-engine.ts` with new optional fields ; hard ones
get standalone files + a custom run-script.

## Skipped (out of scope)

- Civ matchup matrix — need `BoResult` populated. Schema work + scraper.
- Map preference — same as above.
- Cross-tournament transfer learning (player perf at major X correlates
  with major Y) — need richer tournament metadata + grouping.
