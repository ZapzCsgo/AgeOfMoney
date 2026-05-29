'use client';

import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useSession } from 'next-auth/react';
import { Send, Users, Smile, VolumeX, User } from 'lucide-react';
import { cn, parseCoinAmount, formatCoins } from '@/lib/utils';
import { apiClient } from '@/lib/api';
import { tierColor } from '@/lib/level';
import {
  connectAuthenticated, connectTftSocket, getTftSocket,
  onGlobalChat, onOnlineCount, onChatMuted, onChatUnmuted, onChatSystem,
  onSocketConnect, onSocketDisconnect,
  sendGlobalChat, emitMuteUser,
  type ChatMessage, type ChatTier,
} from '@/lib/socket';

/**
 * Global chat panel — TFT-themed port of the AgeOfMoney ChatPanel. The
 * backend is shared (same socket server, same `globalChat` room) so the
 * messages flow between sites if a user is logged into both ; we accept
 * that on purpose, the user base benefits from one active community.
 *
 * Differences from the AoM version :
 *
 * - Palette routes to the `tft-*` Tailwind tokens. Gold accents
 *   collapse to `tft-purple-bright` because gold here is reserved for
 *   the wallet pill / prize pool numbers.
 * - No RainWidget — tft.money doesn't ship the coin-rain feature yet.
 * - No i18n (`useT`) — strings are hardcoded French, mirroring the rest
 *   of the tft.money surface.
 * - Tip flow kept identical to AoM (`POST /users/{id}/tip`) since the
 *   wallet is shared across both surfaces.
 */

const CUSTOM_EMOJIS: { name: string; file: string }[] = [
  { name: 'clownpepe',    file: 'clownpepe.png'      },
  { name: 'demon',        file: 'emo_demon.gif'       },
  { name: 'ezclap',       file: 'ezclapepe.png'       },
  { name: 'fatpepe',      file: 'fatpepe.png'         },
  { name: 'hello',        file: 'hellopepe.gif'       },
  { name: 'joecool',      file: 'joe-cool.png'        },
  { name: 'joemischief',  file: 'joe-mischievous.png' },
  { name: 'kingpepe',     file: 'kingpepe.gif'        },
  { name: 'coffee',       file: 'pepeCoffee.png'      },
  { name: 'feelsbad',     file: 'pepefeelsbadman.gif' },
  { name: 'pepemoney',    file: 'pepemoney.gif'       },
  { name: 'pepewow',      file: 'pepewow.gif'         },
  { name: 'rock',         file: 'rock.gif'            },
  { name: 'takemymoney',  file: 'takemymoney.png'     },
  { name: 'trollface',    file: 'trollface.png'       },
  { name: 'watching',     file: 'watchingpepe.gif'    },
  { name: 'think',        file: 'yb-think.png'        },
];

const EMOJI_MAP = new Map(CUSTOM_EMOJIS.map((e) => [e.name, e.file]));

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function renderMessage(text: string): (string | JSX.Element)[] {
  const parts = text.split(/(:[a-z0-9_-]+:)/gi);
  return parts.map((part, i) => {
    const match = part.match(/^:([a-z0-9_-]+):$/i);
    if (match) {
      const file = EMOJI_MAP.get(match[1]);
      if (file) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={i}
            src={`/emojis/${file}`}
            alt={match[1]}
            className="inline-block w-5 h-5 object-contain align-middle mx-0.5"
          />
        );
      }
    }
    return part;
  });
}

/** Deterministic colour per username — fallback when the user has no avatar. */
function avatarColor(name: string): string {
  const palette = ['#7c3aed', '#a855f7', '#0891b2', '#c084fc', '#be185d', '#1d4ed8'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % palette.length;
  return palette[h];
}

interface ChatMessageProps {
  msg: ChatMessage;
  isMe: boolean;
  onAvatarClick: (msg: ChatMessage, rect: DOMRect) => void;
}

const ChatMessageRow = memo(function ChatMessageRow({ msg, isMe, onAvatarClick }: ChatMessageProps) {
  // System messages render compactly without avatar
  if (msg.userId === 'system') {
    return (
      <div className="px-3 py-1.5 text-center">
        <span className="text-[10px] italic text-tft-text-muted">{msg.message}</span>
      </div>
    );
  }
  const bg = avatarColor(msg.username);
  const color = tierColor(msg.tier);
  return (
    <div
      className={cn(
        'group flex items-start gap-3 px-3 py-2.5 transition-colors cursor-default',
        isMe ? 'bg-tft-purple/[0.06]' : 'hover:bg-tft-bg-hover',
      )}
    >
      <button
        className="shrink-0 relative cursor-pointer hover:opacity-80 transition-opacity"
        onClick={(e) => {
          if (isMe) return;
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          onAvatarClick(msg, rect);
        }}
      >
        <div
          className="w-8 h-8 rounded-md overflow-hidden flex items-center justify-center text-[11px] font-bold text-white"
          style={{ background: msg.avatar ? 'transparent' : bg, border: `1.5px solid ${color}66` }}
        >
          {msg.avatar
            ? /* eslint-disable-next-line @next/next/no-img-element */
              <img src={msg.avatar} alt={msg.username} className="w-full h-full object-cover" />
            : msg.username.slice(0, 2).toUpperCase()}
        </div>
        <div
          className="absolute -bottom-1 -right-1 text-[9px] font-black rounded-sm flex items-center justify-center"
          style={{ background: color, color: '#07060f', width: 16, height: 14, lineHeight: 1 }}
        >
          {msg.level}
        </div>
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
          <span className={cn('text-[12px] font-semibold leading-none', isMe ? 'text-tft-purple-bright' : 'text-tft-text')}>
            {msg.username}
          </span>
          {msg.isAdmin && (
            <span className="text-[8.5px] font-bold px-1 py-0.5 rounded-sm bg-tft-rose/15 text-tft-rose-bright border border-tft-rose/30">
              ADMIN
            </span>
          )}
          {msg.isMod && !msg.isAdmin && (
            <span className="text-[8.5px] font-bold px-1 py-0.5 rounded-sm bg-blue-500/15 text-blue-300 border border-blue-500/30">
              MOD
            </span>
          )}
          {msg.isPartner && (
            <span className="text-[8.5px] font-bold px-1 py-0.5 rounded-sm bg-tft-purple/15 text-tft-purple-bright border border-tft-purple/30">
              PARTNER
            </span>
          )}
          <span className="text-[9.5px] text-tft-text-muted opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0">
            {formatTime(msg.timestamp)}
          </span>
        </div>
        <p className="text-[12.5px] text-tft-text-dim leading-snug break-words">
          {renderMessage(msg.message)}
        </p>
      </div>
    </div>
  );
});

export function ChatPanel() {
  const { data: session } = useSession();
  const [messages, setMessages]       = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated]       = useState(false);
  const [input, setInput]             = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [connected, setConnected]     = useState(false);
  const [mutedUntil, setMutedUntil]   = useState<Date | null>(null);
  const [muteTarget, setMuteTarget]   = useState<{ userId: string; username: string } | null>(null);
  const [muteDuration, setMuteDuration] = useState(15);
  const [showEmojis, setShowEmojis]   = useState(false);
  const [userMenu, setUserMenu] = useState<{
    userId: string; username: string; avatar: string | null; isAdmin: boolean; x: number; y: number;
  } | null>(null);
  const [tipAmount, setTipAmount] = useState('');
  const [tipping, setTipping]     = useState(false);
  const [tipMsg, setTipMsg]       = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const emojiRef  = useRef<HTMLDivElement>(null);
  const menuRef   = useRef<HTMLDivElement>(null);

  // Hydrate persisted history after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('tft_chat_history');
      if (saved) setMessages(JSON.parse(saved));
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  // Persist last 50 + auto-scroll on new message
  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem('tft_chat_history', JSON.stringify(messages.slice(-50))); } catch { /* ignore */ }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, hydrated]);

  // Memoised avatar click handler — keeps memo() short-circuit working
  const handleAvatarClick = useCallback((msg: ChatMessage, rect: DOMRect) => {
    setUserMenu({
      userId: msg.userId,
      username: msg.username,
      avatar: msg.avatar,
      isAdmin: msg.isAdmin,
      x: rect.right + 4,
      y: rect.top,
    });
    setTipAmount('');
    setTipMsg(null);
  }, []);

  // Click-outside for emoji picker / user menu
  useEffect(() => {
    if (!showEmojis) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojis(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojis]);

  useEffect(() => {
    if (!userMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenu(null); setTipAmount(''); setTipMsg(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [userMenu]);

  // ── Socket wiring ─────────────────────────────────────────────────────
  useEffect(() => {
    // Anonymous connection — globalChat events flow even without auth ;
    // sending requires auth which we handle in `handleSend`.
    connectTftSocket();

    const offConn    = onSocketConnect(() => setConnected(true));
    const offDis     = onSocketDisconnect(() => setConnected(false));
    const offChat    = onGlobalChat((msg) =>
      setMessages((prev) => {
        const next = [...prev, msg];
        return next.length > 100 ? next.slice(-100) : next;
      }),
    );
    const offOnline  = onOnlineCount(setOnlineCount);
    const offMuted   = onChatMuted((d) => setMutedUntil(new Date(d.until)));
    const offUnmuted = onChatUnmuted(() => setMutedUntil(null));
    const offSystem  = onChatSystem((d) =>
      setMessages((prev) => [
        ...prev,
        {
          id: `sys_${Date.now()}`,
          userId: 'system',
          username: 'Système',
          avatar: null,
          coins: 0,
          level: 0,
          tier: 'bronze' as ChatTier,
          isAdmin: false,
          isMod: false,
          isPartner: false,
          message: d.message,
          timestamp: new Date().toISOString(),
        },
      ]),
    );

    if (getTftSocket().connected) setConnected(true);

    return () => {
      offConn(); offDis(); offChat(); offOnline(); offMuted(); offUnmuted(); offSystem();
    };
  }, []);

  // Re-auth when the session token changes
  useEffect(() => {
    const token = session?.user?.accessToken;
    if (!token) return;
    connectAuthenticated(token);
    const timer = setTimeout(() => setConnected(getTftSocket().connected), 500);
    return () => clearTimeout(timer);
  }, [session?.user?.accessToken]);

  const iCanMod = session?.user?.isAdmin === true; // tft.money doesn't ship the mod role yet — admin only

  const handleTip = useCallback(async () => {
    if (!userMenu || !tipAmount) return;
    setTipping(true);
    setTipMsg(null);
    try {
      const amt = parseCoinAmount(tipAmount);
      await apiClient.post(`/users/${userMenu.userId}/tip`, { amount: amt });
      setTipMsg(`✓ ${formatCoins(amt)} ◈ envoyés à ${userMenu.username}`);
      setTipAmount('');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setTipMsg(err?.response?.data?.error ?? 'Erreur');
    } finally {
      setTipping(false);
    }
  }, [userMenu, tipAmount]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !session || !connected) return;
    sendGlobalChat(text);
    setInput('');
    inputRef.current?.focus();
  }, [input, session, connected]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const insertEmoji = useCallback((emoji: string) => {
    setInput((prev) => (prev + emoji).slice(0, 200));
    setShowEmojis(false);
    inputRef.current?.focus();
  }, []);

  return (
    <aside
      className="hidden lg:flex flex-col shrink-0 border-l border-tft-border bg-tft-bg-card/30 sticky top-14 self-start"
      style={{ width: 290, minWidth: 290, height: 'calc(100vh - 3.5rem)' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-tft-border bg-tft-bg">
        <div className="flex items-center gap-2">
          <span className="font-display font-bold text-[12px] tracking-[0.18em] uppercase text-tft-purple-bright">
            tft.money
          </span>
          <span className="text-tft-text-muted text-[11px]">/</span>
          <span className="text-tft-text-dim text-[11px] font-medium">Chat</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-tft-text-muted')} />
          <span className="text-emerald-400 text-[11px] font-medium tabular-nums">{onlineCount}</span>
          <Users size={11} className="text-tft-text-muted" />
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto min-h-0 py-1"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2d2850 transparent' }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="w-8 h-8 rounded-full bg-tft-bg-elevated flex items-center justify-center">
              <Users size={14} className="text-tft-text-muted" />
            </div>
            <p className="text-[11px] text-tft-text-muted text-center px-4">
              {connected ? 'Aucun message — soyez le premier à écrire.' : 'Connexion au chat...'}
            </p>
          </div>
        ) : (
          messages.map((msg) => (
            <ChatMessageRow
              key={msg.id}
              msg={msg}
              isMe={msg.userId === session?.user?.id}
              onAvatarClick={handleAvatarClick}
            />
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-tft-border bg-tft-bg">
        {session ? (
          <>
            {mutedUntil && mutedUntil > new Date() ? (
              <div className="px-3 py-3 text-center">
                <VolumeX size={14} className="mx-auto mb-1 text-tft-rose" />
                <p className="text-[11px] text-tft-rose">
                  Muté jusqu&apos;à {mutedUntil.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ) : (
              <>
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 rounded-md px-3 h-9 bg-tft-bg-elevated border border-tft-border">
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Écris un message..."
                      maxLength={200}
                      disabled={!connected}
                      className="flex-1 bg-transparent text-[12px] text-tft-text placeholder:text-tft-text-muted outline-none border-none disabled:opacity-50"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || !connected}
                      className="w-6 h-6 rounded-sm flex items-center justify-center shrink-0 disabled:opacity-30 transition-all hover:scale-110 cursor-pointer"
                      style={{ background: input.trim() ? '#a78bfa' : 'transparent' }}
                    >
                      <Send size={11} style={{ color: input.trim() ? '#07060f' : '#6b6488' }} />
                    </button>
                  </div>
                </div>
                <div className="relative px-3 pb-2" ref={emojiRef}>
                  <button
                    onClick={() => setShowEmojis((v) => !v)}
                    className={cn(
                      'flex items-center justify-center w-8 h-8 rounded-md border transition-all cursor-pointer',
                      showEmojis
                        ? 'text-tft-purple-bright border-tft-purple/40 bg-tft-purple/10'
                        : 'text-tft-text-dim border-tft-border bg-tft-bg-card hover:text-tft-purple-bright hover:border-tft-purple/30 hover:bg-tft-purple/5',
                    )}
                    title="Emojis"
                  >
                    <Smile size={17} />
                  </button>
                  {showEmojis && (
                    <div
                      className="absolute bottom-full left-0 mb-1 rounded-lg overflow-hidden shadow-2xl bg-tft-bg-card border border-tft-border z-[200]"
                      style={{ width: 260 }}
                    >
                      <div className="grid grid-cols-7 gap-0.5 px-2 py-2">
                        {CUSTOM_EMOJIS.map((e) => (
                          <button
                            key={e.name}
                            onClick={() => insertEmoji(`:${e.name}:`)}
                            className="w-8 h-8 rounded-sm flex items-center justify-center hover:bg-tft-bg-hover transition-colors cursor-pointer"
                            title={e.name}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={`/emojis/${e.file}`} alt={e.name} className="w-6 h-6 object-contain" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="px-3 py-3 text-center">
            <p className="text-[11px] text-tft-text-muted leading-relaxed">
              <span className="text-tft-purple-bright font-semibold">Connexion requise</span>
              <br />
              Connecte-toi via Steam pour participer au chat.
            </p>
          </div>
        )}
      </div>

      {/* User context menu */}
      {userMenu && (
        <div
          ref={menuRef}
          className="fixed z-[400] rounded-lg shadow-2xl overflow-hidden bg-tft-bg-card border border-tft-border"
          style={{
            left: Math.min(userMenu.x, window.innerWidth - 200),
            top: Math.min(userMenu.y, window.innerHeight - 250),
            width: 188,
          }}
        >
          <div className="flex items-center gap-2 px-3 py-2.5 border-b border-tft-border">
            <div className="w-7 h-7 rounded-md overflow-hidden shrink-0 bg-tft-bg-elevated">
              {userMenu.avatar && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={userMenu.avatar} alt={userMenu.username} className="w-full h-full object-cover" />
              )}
            </div>
            <span className="text-[12px] font-bold text-tft-text truncate">{userMenu.username}</span>
          </div>

          <a
            href={`/profile?id=${userMenu.userId}`}
            className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-tft-text-dim hover:bg-tft-bg-hover transition-colors"
            onClick={() => setUserMenu(null)}
          >
            <User size={13} className="text-tft-text-muted" /> Voir le profil
          </a>

          {session && (
            <div className="px-3 py-2 border-t border-tft-border">
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[11px] text-tft-gold-bright">◈</span>
                <span className="text-[11px] text-tft-text-dim">Envoyer des coins</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  min={10}
                  max={10000}
                  value={tipAmount}
                  onChange={(e) => setTipAmount(e.target.value)}
                  placeholder="10"
                  className="flex-1 w-0 rounded-sm px-2 py-1 text-[11px] text-tft-text outline-none bg-tft-bg-elevated border border-tft-border [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <button
                  onClick={handleTip}
                  disabled={tipping || !tipAmount}
                  className="px-2 py-1 rounded-sm text-[11px] font-bold disabled:opacity-40 transition-opacity cursor-pointer bg-tft-purple text-white hover:bg-tft-purple-bright"
                >
                  {tipping ? '…' : 'Tip'}
                </button>
              </div>
              {tipMsg && (
                <p className={cn('text-[10px] mt-1', tipMsg.startsWith('✓') ? 'text-emerald-400' : 'text-tft-rose')}>
                  {tipMsg}
                </p>
              )}
            </div>
          )}

          {iCanMod && !userMenu.isAdmin && (
            <button
              onClick={() => {
                setMuteTarget({ userId: userMenu.userId, username: userMenu.username });
                setUserMenu(null);
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-tft-rose hover:bg-tft-bg-hover transition-colors border-t border-tft-border cursor-pointer"
            >
              <VolumeX size={13} /> Muter
            </button>
          )}
        </div>
      )}

      {/* Mute duration picker */}
      {muteTarget && (
        <div
          className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setMuteTarget(null)}
        >
          <div
            className="rounded-lg p-5 w-64 bg-tft-bg-card border border-tft-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-[13px] mb-1 flex items-center gap-2 text-tft-purple-bright">
              <VolumeX size={14} /> Muter {muteTarget.username}
            </h3>
            <p className="text-[11px] mb-3 text-tft-text-muted">Durée du mute</p>
            <div className="grid grid-cols-3 gap-1.5 mb-4">
              {[5, 15, 60, 360, 1440, 10080].map((min) => (
                <button
                  key={min}
                  onClick={() => setMuteDuration(min)}
                  className={cn(
                    'py-1.5 rounded-sm text-[10px] font-bold transition-all cursor-pointer border',
                    muteDuration === min
                      ? 'bg-tft-purple/15 border-tft-purple text-tft-purple-bright'
                      : 'bg-tft-bg-elevated border-tft-border text-tft-text-muted hover:text-tft-text-dim',
                  )}
                >
                  {min < 60 ? `${min}m` : min < 1440 ? `${min / 60}h` : min === 1440 ? '24h' : '7j'}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setMuteTarget(null)}
                className="flex-1 py-2 rounded-sm text-[11px] bg-tft-bg-elevated border border-tft-border text-tft-text-muted hover:text-tft-text cursor-pointer"
              >
                Annuler
              </button>
              <button
                onClick={() => {
                  emitMuteUser(muteTarget.userId, muteDuration);
                  setMuteTarget(null);
                }}
                className="flex-1 py-2 rounded-sm text-[11px] font-bold bg-tft-purple text-white hover:bg-tft-purple-bright cursor-pointer"
              >
                Muter
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
