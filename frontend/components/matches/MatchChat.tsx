'use client';

import { useState, useEffect, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { Send, MessageSquare } from 'lucide-react';
import { joinMatchRoom, leaveMatchRoom, sendChatMessage, onChatMessage, connectSocket, getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

interface MatchChatProps {
  matchId: string;
}

interface ChatMsg {
  id: string;
  userId?: string;
  username?: string;
  avatar?: string | null;
  message: string;
  coins?: number;
  level?: number;
  tier?: string;
  isAdmin?: boolean;
  isMod?: boolean;
  isPartner?: boolean;
  timestamp: string;
}

const MAX_MESSAGES = 100;

// Level badge colours — tier per bracket of 10 levels
const TIER_STYLES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  bronze:   { bg: 'rgba(180,100,40,0.2)',  text: '#cd7f32', border: 'rgba(180,100,40,0.5)',  label: 'Br'  },
  silver:   { bg: 'rgba(150,160,170,0.2)', text: '#a8b8c8', border: 'rgba(150,160,170,0.5)', label: 'Ag'  },
  gold:     { bg: 'rgba(212,160,23,0.2)',  text: '#d4a017', border: 'rgba(212,160,23,0.5)',  label: 'Or'  },
  platinum: { bg: 'rgba(100,200,210,0.2)', text: '#64c8d2', border: 'rgba(100,200,210,0.5)', label: 'Pt'  },
  diamond:  { bg: 'rgba(120,100,220,0.2)', text: '#9b6aef', border: 'rgba(120,100,220,0.5)', label: 'Di'  },
  legend:   { bg: 'rgba(231,76,60,0.2)',   text: '#e74c3c', border: 'rgba(231,76,60,0.5)',   label: 'LG'  },
};

function getLevelTier(level: number): string {
  if (level >= 51) return 'legend';
  if (level >= 41) return 'diamond';
  if (level >= 31) return 'platinum';
  if (level >= 21) return 'gold';
  if (level >= 11) return 'silver';
  return 'bronze';
}

function LevelBadge({ level }: { level: number }) {
  const tier = getLevelTier(level);
  const style = TIER_STYLES[tier];
  return (
    <span
      className="inline-flex items-center justify-center rounded px-1 py-px text-[9px] font-bold font-cinzel shrink-0"
      style={{ background: style.bg, color: style.text, border: `1px solid ${style.border}`, minWidth: 24 }}
      title={`Niveau ${level} — ${tier}`}
    >
      {level}
    </span>
  );
}

// Simple silhouette SVG for users without avatar
function UserSilhouette({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      className={className}
      style={{ borderRadius: '50%', background: 'rgba(212,160,23,0.08)' }}
    >
      <circle cx="12" cy="8" r="4" fill="rgba(212,160,23,0.4)" />
      <path d="M4 20c0-4.418 3.582-8 8-8s8 3.582 8 8" fill="rgba(212,160,23,0.25)" />
    </svg>
  );
}

export function MatchChat({ matchId }: MatchChatProps) {
  const { data: session } = useSession();
  const { t } = useT();
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      id: 'sys-1',
      userId: 'system',
      username: 'Système',
      message: 'Bienvenue dans le chat du match !',
      isAdmin: true,
      timestamp: new Date().toISOString(),
    },
  ]);
  const [input, setInput] = useState('');
  const [connected, setConnected] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const token = session?.user?.accessToken;
    connectSocket(token);

    const s = getSocket();

    const handleConnect = () => {
      setConnected(true);
      s.emit('joinMatchRoom', matchId);
    };
    const handleDisconnect = () => setConnected(false);

    // If already connected after auth update, join room immediately
    if (s.connected) {
      setConnected(true);
      s.emit('joinMatchRoom', matchId);
    }

    s.on('connect', handleConnect);
    s.on('disconnect', handleDisconnect);

    const unsub = onChatMessage((msg) => {
      setMessages((prev) => [...prev, msg as ChatMsg].slice(-MAX_MESSAGES));
    });

    return () => {
      s.off('connect', handleConnect);
      s.off('disconnect', handleDisconnect);
      leaveMatchRoom(matchId);
      unsub();
    };
  }, [matchId, session]);

  useEffect(() => {
    // Use block:'nearest' so only the chat container scrolls, not the whole page
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !session) return;
    sendChatMessage(matchId, trimmed);
    setInput('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col rounded-xl overflow-hidden border" style={{ height: 400, background: '#0d0b1a', borderColor: '#1e1a30' }}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: '#1e1a30' }}>
        <MessageSquare size={14} className="text-aoe-gold" />
        <span className="font-cinzel text-xs font-bold text-aoe-gold tracking-wider">CHAT DU MATCH</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-gray-500')} />
          <span className="text-aoe-parchment-muted text-[10px]">{connected ? 'En ligne' : 'Hors ligne'}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {messages.map((msg) => {
          const isOwn   = msg.userId === session?.user?.id;
          const isSys   = msg.userId === 'system';
          const level   = msg.level ?? 1;

          if (isSys) {
            return (
              <p key={msg.id} className="text-[10px] text-center text-aoe-parchment-muted italic py-0.5">
                {msg.message}
              </p>
            );
          }

          return (
            <div key={msg.id} className={cn('flex gap-1.5 items-end', isOwn && 'flex-row-reverse')}>
              {/* Avatar */}
              {msg.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={msg.avatar} alt={msg.username ?? ''} className="w-6 h-6 rounded-full shrink-0 object-cover border" style={{ borderColor: '#1e1a30' }} />
              ) : (
                <UserSilhouette size={24} className="shrink-0" />
              )}

              <div className={cn('flex flex-col gap-0.5 max-w-[78%]', isOwn && 'items-end')}>
                {/* Username + level badge */}
                <div className={cn('flex items-center gap-1', isOwn && 'flex-row-reverse')}>
                  {!isSys && <LevelBadge level={level} />}
                  <span className={cn(
                    'text-[10px] font-semibold truncate',
                    msg.isAdmin ? 'text-red-400' : isOwn ? 'text-aoe-gold' : 'text-aoe-parchment-dim'
                  )}>
                    {msg.username}
                  </span>
                  {msg.isAdmin && (
                    <span className="text-[8px] font-bold px-1 py-px rounded" style={{ background: '#be123c33', color: '#f87171', border: '1px solid #be123c55' }}>ADMIN</span>
                  )}
                  {msg.isMod && !msg.isAdmin && (
                    <span className="text-[8px] font-bold px-1 py-px rounded" style={{ background: '#1e3a5f', color: '#60a5fa', border: '1px solid #3b82f640' }}>MOD</span>
                  )}
                  {msg.isPartner && (
                    <span className="text-[8px] font-bold px-1 py-px rounded" style={{ background: '#2d1b4e', color: '#c084fc', border: '1px solid #a855f740' }}>PARTNER</span>
                  )}
                </div>

                {/* Bubble */}
                <div className={cn(
                  'px-2.5 py-1.5 rounded-xl text-xs leading-relaxed break-words',
                  isOwn
                    ? 'rounded-br-sm text-aoe-parchment'
                    : 'rounded-bl-sm text-aoe-parchment'
                )} style={{
                  background: isOwn
                    ? 'rgba(212,160,23,0.12)'
                    : 'rgba(255,255,255,0.05)',
                  border: `1px solid ${isOwn ? 'rgba(212,160,23,0.25)' : 'rgba(255,255,255,0.07)'}`,
                }}>
                  {msg.message}
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t p-2" style={{ borderColor: '#1e1a30' }}>
        {session ? (
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value.substring(0, 200))}
              onKeyDown={handleKeyDown}
              placeholder={t('chat_placeholder')}
              className="flex-1 rounded-lg px-3 py-2 text-xs text-aoe-parchment placeholder-aoe-parchment-muted/50 outline-none transition-colors"
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid #1e1a30' }}
              maxLength={200}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="p-2 rounded-lg transition-all disabled:opacity-30"
              style={{ background: input.trim() ? 'rgba(212,160,23,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid #1e1a30', color: '#d4a017' }}
            >
              <Send size={14} />
            </button>
          </div>
        ) : (
          <p className="text-center text-aoe-parchment-muted/60 text-[10px] font-cinzel py-1">
            {t('chat_signin_prompt')} {t('chat_signin_desc')}
          </p>
        )}
      </div>
    </div>
  );
}
