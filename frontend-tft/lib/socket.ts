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

/** Re-auths the socket if the token has changed since last connect. Idempotent. */
export function connectAuthenticated(token: string): void {
  ensureSocket(token);
  // ensureSocket already forces a disconnect when the token changes ; here we
  // just make sure we end up connected.
  if (!socket?.connected) socket?.connect();
}

/** Direct access for emit calls (chat send, mute, etc.) */
export function getTftSocket(): Socket {
  return ensureSocket();
}

export type ChatTier = 'legend' | 'diamond' | 'platinum' | 'gold' | 'silver' | 'bronze';

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  coins: number;
  level: number;
  tier: ChatTier;
  isAdmin: boolean;
  isMod: boolean;
  isPartner: boolean;
  message: string;
  timestamp: string;
}

export function onGlobalChat(cb: (msg: ChatMessage) => void): () => void {
  const s = ensureSocket();
  s.on('globalChat', cb);
  return () => s.off('globalChat', cb);
}

export function onOnlineCount(cb: (n: number) => void): () => void {
  const s = ensureSocket();
  s.on('onlineCount', cb);
  return () => s.off('onlineCount', cb);
}

export function onChatMuted(cb: (data: { until: string; remainingMinutes: number; by?: string }) => void): () => void {
  const s = ensureSocket();
  s.on('chatMuted', cb);
  return () => s.off('chatMuted', cb);
}

export function onChatUnmuted(cb: () => void): () => void {
  const s = ensureSocket();
  s.on('chatUnmuted', cb);
  return () => s.off('chatUnmuted', cb);
}

export function onChatSystem(cb: (data: { message: string }) => void): () => void {
  const s = ensureSocket();
  s.on('chatSystem', cb);
  return () => s.off('chatSystem', cb);
}

export function onSocketConnect(cb: () => void): () => void {
  const s = ensureSocket();
  s.on('connect', cb);
  return () => s.off('connect', cb);
}

export function onSocketDisconnect(cb: () => void): () => void {
  const s = ensureSocket();
  s.on('disconnect', cb);
  return () => s.off('disconnect', cb);
}

export function sendGlobalChat(message: string): void {
  const s = ensureSocket();
  if (!s.connected) return;
  s.emit('globalChat', { message });
}

export function emitMuteUser(userId: string, durationMinutes: number): void {
  const s = ensureSocket();
  if (!s.connected) return;
  s.emit('muteUser', { userId, durationMinutes });
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
