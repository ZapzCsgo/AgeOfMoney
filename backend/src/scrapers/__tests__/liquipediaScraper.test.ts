/**
 * Tests for the Liquipedia scraper helpers.
 *
 * Run via :
 *   cd backend && SKIP_SERVER=1 npx tsx --test src/scrapers/__tests__/liquipediaScraper.test.ts
 *
 * Regression coverage for prod bug #3 (2026-05-02) :
 *   `prisma.player.upsert({ where: { liquipediaSlug } })` blew up with
 *   Prisma P2002 when two distinct LP slugs shared the same `name` (e.g.
 *   "Overtaken" exists with slug `Overtaken_(player)` ; new LP page tries
 *   to create slug `Overtaken_(esports)`). The upsert path lost the entire
 *   match save — `upsertPlayerWithNameCollisionFallback` catches P2002 on
 *   `name` and reuses the existing row.
 *
 * The helper now accepts a `PlayerUpsertClient` so we can pass a pure
 * stub object — no need to mock Prisma's module-level instance.
 */
process.env.SKIP_SERVER = '1';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  upsertPlayerWithNameCollisionFallback,
  type PlayerUpsertClient,
} from '../liquipediaScraper';

type StubBehavior = 'success' | 'p2002-name' | 'p2002-other' | 'unknown-error';

function makeStub(behavior: StubBehavior, existing: { id: string; name: string; elo: number; liquipediaSlug: string } | null) {
  let upsertCalls = 0;
  let findUniqueCalls = 0;
  const client: PlayerUpsertClient = {
    player: {
      upsert: async () => {
        upsertCalls++;
        if (behavior === 'success') return { id: 'new-id', name: 'TestName', elo: 1500 };
        if (behavior === 'p2002-name') {
          const e = new Error('Unique constraint failed') as Error & { code?: string; meta?: { target?: string[] } };
          e.code = 'P2002';
          e.meta = { target: ['name'] };
          throw e;
        }
        if (behavior === 'p2002-other') {
          const e = new Error('Unique constraint failed on liquipediaSlug') as Error & { code?: string; meta?: { target?: string[] } };
          e.code = 'P2002';
          e.meta = { target: ['liquipediaSlug'] };
          throw e;
        }
        throw new Error('boom');
      },
      findUnique: async () => {
        findUniqueCalls++;
        return existing;
      },
    },
  };
  return { client, getCalls: () => ({ upsertCalls, findUniqueCalls }) };
}

test('happy path : upsert returns the created player directly', async () => {
  const { client, getCalls } = makeStub('success', null);
  const r = await upsertPlayerWithNameCollisionFallback(
    { name: 'TestName', liquipediaSlug: 'TestName_(player)', country: 'fr', game: 'AoE4' },
    client,
  );
  const calls = getCalls();
  assert.equal(calls.upsertCalls, 1);
  assert.equal(calls.findUniqueCalls, 0);
  assert.equal(r.id, 'new-id');
  assert.equal(r.elo, 1500);
});

test('P2002 on name → falls back to existing row by name', async () => {
  const { client, getCalls } = makeStub('p2002-name', {
    id: 'existing-id', name: 'TestName', elo: 1750, liquipediaSlug: 'TestName_(canonical)',
  });
  const r = await upsertPlayerWithNameCollisionFallback(
    { name: 'TestName', liquipediaSlug: 'TestName_(esports)', country: 'fr', game: 'AoE4' },
    client,
  );
  const calls = getCalls();
  assert.equal(calls.upsertCalls, 1);
  assert.equal(calls.findUniqueCalls, 1);
  assert.equal(r.id, 'existing-id');
  assert.equal(r.elo, 1750);
});

test('P2002 on name with no existing row found → rethrows', async () => {
  const { client } = makeStub('p2002-name', null);
  await assert.rejects(
    upsertPlayerWithNameCollisionFallback(
      { name: 'GhostName', liquipediaSlug: 'GhostName_(?)', country: null, game: 'AoE4' },
      client,
    ),
    (err: Error & { code?: string }) => err.code === 'P2002',
  );
});

test('P2002 on a different field (not name) → rethrows, no findUnique', async () => {
  const { client, getCalls } = makeStub('p2002-other', null);
  await assert.rejects(
    upsertPlayerWithNameCollisionFallback(
      { name: 'X', liquipediaSlug: 'X_(s)', country: null, game: 'AoE4' },
      client,
    ),
    (err: Error & { code?: string }) => err.code === 'P2002',
  );
  assert.equal(getCalls().findUniqueCalls, 0);
});

test('non-Prisma error → rethrows verbatim', async () => {
  const { client } = makeStub('unknown-error', null);
  await assert.rejects(
    upsertPlayerWithNameCollisionFallback(
      { name: 'X', liquipediaSlug: 'X_(s)', country: null, game: 'AoE4' },
      client,
    ),
    /boom/,
  );
});

// Force exit — Prisma client + Bottleneck keep the loop alive even with
// SKIP_SERVER=1, see liquipediaLiveScorer.test.ts for the same trick.
test('cleanup', () => { setImmediate(() => process.exit(0)); });
