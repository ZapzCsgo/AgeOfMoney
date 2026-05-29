'use client';

import { io, Socket } from 'socket.io-client';

/**
 * Thin socket.io client for tft.money. Backend at `NEXT_PUBLIC_WS_URL`
 * (same Express server as the REST API) emits these TFT-specific events :
 *
 *   tft:standings  → { tournamentId, standings: [{ participantId, rank }] }
 *   tft:tournament → { tournamentId, kind: 'created' | 'updated' }
 *
 * Anonymous connections are allowed (read-only) — the JWT is only needed
 * if a future feature wants per-user emits (bet results, balance push).
 */

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';

let socket: Socket | null = null;

function ensureSocket(token?: string): Socket {
  if (socket) {
    if (token && (socket.auth as { token?: string })?.token !== token) {
      socket.auth = { token };
      if (socket.connected) socket.disconnect();
    }
    return socket;
  }
  socket = io(WS_URL, {
    autoConnect: false,
    transports: ['websocket', 'polling'],
    auth: token ? { token } : {},
  });
  return socket;
}

export function connectTftSocket(token?: string): void {
  const s = ensureSocket(token);
  if (!s.connected) s.connect();
}

export function disconnectTftSocket(): void {
  socket?.disconnect();
}

/* ── Event listener helpers (return cleanup fn) ─────────────────────── */

export interface TftStandingsPayload {
  tournamentId: string;
  standings: Array<{ participantId: string; rank: number }>;
}

export function onTftStandings(cb: (data: TftStandingsPayload) => void): () => void {
  const s = ensureSocket();
  s.on('tft:standings', cb);
  return () => s.off('tft:standings', cb);
}

export interface TftTournamentChangedPayload {
  tournamentId: string;
  /** "created" when the scraper persists a new tournament for the first time,
   *  "updated" when an existing tournament's metadata changes (status flip,
   *  participant added, prize pool announced). */
  kind: 'created' | 'updated';
}

export function onTftTournamentChanged(
  cb: (data: TftTournamentChangedPayload) => void,
): () => void {
  const s = ensureSocket();
  s.on('tft:tournament', cb);
  return () => s.off('tft:tournament', cb);
}
