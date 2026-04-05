'use client';

import { io, Socket } from 'socket.io-client';
import { SocketBetPlaced, SocketOddsUpdate, SocketMatchStatus, SocketChatMessage } from '@/types';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000';

let socket: Socket | null = null;

export function getSocket(token?: string): Socket {
  if (!socket) {
    socket = io(WS_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
      auth: token ? { token } : {},
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id);
    });

    socket.on('disconnect', (reason) => {
      console.log('[Socket] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.error('[Socket] Connection error:', err.message);
    });
  }

  return socket;
}

export function connectSocket(token?: string): void {
  const s = getSocket(token);
  const currentToken = (s.auth as { token?: string })?.token;

  // If we now have a token but socket is already connected without one → reconnect authenticated
  if (token && token !== currentToken) {
    s.auth = { token };
    if (s.connected) {
      s.disconnect();
    }
  }

  if (!s.connected) {
    s.connect();
  }
}

export function disconnectSocket(): void {
  if (socket?.connected) {
    socket.disconnect();
  }
}

export function joinMatchRoom(matchId: string): void {
  const s = getSocket();
  if (s.connected) {
    s.emit('joinMatchRoom', matchId);
  } else {
    s.once('connect', () => {
      s.emit('joinMatchRoom', matchId);
    });
    s.connect();
  }
}

export function leaveMatchRoom(matchId: string): void {
  socket?.emit('leaveMatchRoom', matchId);
}

export function sendChatMessage(matchId: string, message: string): void {
  if (!socket?.connected) {
    console.warn('[Socket] Not connected, cannot send message');
    return;
  }
  socket.emit('chatMessage', { matchId, message });
}

export function onBetPlaced(callback: (data: SocketBetPlaced) => void): () => void {
  const s = getSocket();
  s.on('betPlaced', callback);
  return () => s.off('betPlaced', callback);
}

export function onOddsUpdate(callback: (data: SocketOddsUpdate) => void): () => void {
  const s = getSocket();
  s.on('oddsUpdate', callback);
  return () => s.off('oddsUpdate', callback);
}

export function onMatchStatusUpdate(callback: (data: SocketMatchStatus) => void): () => void {
  const s = getSocket();
  s.on('matchStatusUpdate', callback);
  return () => s.off('matchStatusUpdate', callback);
}

export function onChatMessage(callback: (data: SocketChatMessage) => void): () => void {
  const s = getSocket();
  s.on('chatMessage', callback);
  return () => s.off('chatMessage', callback);
}

export function onBettingClosed(callback: (data: { matchId: string; closedAt: string }) => void): () => void {
  const s = getSocket();
  s.on('bettingClosed', callback);
  return () => s.off('bettingClosed', callback);
}

export interface BetResultPayload {
  matchId: string;
  betId: string;
  won: boolean;
  amount: number;
  payout: number;
  playerBetOn?: string;
  winnerName?: string;
  loserName?: string;
  tournamentName?: string;
}

export function onBetResult(callback: (data: BetResultPayload) => void): () => void {
  const s = getSocket();
  s.on('betResult', callback);
  return () => s.off('betResult', callback);
}

export function onCoinsUpdate(callback: (data: { coins: number; direction?: 'up' | 'down' }) => void): () => void {
  const s = getSocket();
  s.on('coinsUpdate', callback);
  return () => s.off('coinsUpdate', callback);
}

export interface AppNotificationPayload {
  type: 'tip' | 'deposit' | 'withdrawal';
  from?: string;   // for tips
  amount: number;
}

export function onNotification(callback: (data: AppNotificationPayload) => void): () => void {
  const s = getSocket();
  s.on('notification', callback);
  return () => s.off('notification', callback);
}

export { socket };
