'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Send, Users, Smile, VolumeX, User, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';
import { connectSocket, getSocket } from '@/lib/socket';
import { useT } from '@/lib/i18n';
import { apiClient } from '@/lib/api';

// Custom image emojis — also used for rendering shortcodes in messages
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

interface ChatMsg {
  id: string;
  userId: string;
  username: string;
  avatar: string | null;
  coins: number;
  level: number;
  tier: string;
  isAdmin: boolean;
  isMod: boolean;
  isPartner: boolean;
  message: string;
  timestamp: string;
}

function levelColor(tier: string): string {
  switch (tier) {
    case 'legend':   return '#a855f7';
    case 'diamond':  return '#06b6d4';
    case 'platinum': return '#38bdf8';
    case 'gold':     return '#d4a017';
    case 'silver':   return '#94a3b8';
    default:         return '#78716c';
  }
}

function formatTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Build a lookup map for fast shortcode → file resolution
const EMOJI_MAP = new Map(CUSTOM_EMOJIS.map(e => [e.name, e.file]));

// Renders a chat message, replacing :shortcode: with inline images
function renderMessage(text: string): (string | JSX.Element)[] {
  const parts = text.split(/(:[a-z0-9_-]+:)/gi);
  return parts.map((part, i) => {
    const match = part.match(/^:([a-z0-9_-]+):$/i);
    if (match) {
      const file = EMOJI_MAP.get(match[1]);
      if (file) {
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={i} src={`/emojis/${file}`} alt={match[1]} className="inline-block w-5 h-5 object-contain align-middle mx-0.5" />
        );
      }
    }
    return part;
  });
}

// Generate a deterministic color per username for avatar bg
function avatarColor(name: string): string {
  const colors = ['#7c3aed','#0891b2','#b45309','#047857','#be185d','#1d4ed8'];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % colors.length;
  return colors[h];
}

export function ChatPanel() {
  const { data: session } = useSession();
  const { t } = useT();
  const [messages, setMessages]       = useState<ChatMsg[]>([]);
  const [hydrated, setHydrated]       = useState(false);

  // Load chat history from sessionStorage after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('chat_history');
      if (saved) setMessages(JSON.parse(saved));
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);
  const [input, setInput]             = useState('');
  const [onlineCount, setOnlineCount] = useState(0);
  const [connected, setConnected]     = useState(false);
  const [mutedUntil, setMutedUntil]   = useState<Date | null>(null);
  const [muteTarget, setMuteTarget]   = useState<{ userId: string; username: string } | null>(null);
  const [muteDuration, setMuteDuration] = useState(15);
  const [showEmojis, setShowEmojis]   = useState(false);
  const [userMenu, setUserMenu]       = useState<{ userId: string; username: string; avatar: string | null; isAdmin: boolean; x: number; y: number } | null>(null);
  const [tipAmount, setTipAmount]     = useState('');
  const [tipping, setTipping]         = useState(false);
  const [tipMsg, setTipMsg]           = useState<string | null>(null);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);
  const emojiRef   = useRef<HTMLDivElement>(null);
  const menuRef    = useRef<HTMLDivElement>(null);

  // Close emoji picker when clicking outside
  useEffect(() => {
    if (!showEmojis) return;
    const handler = (e: MouseEvent) => {
      if (emojiRef.current && !emojiRef.current.contains(e.target as Node)) setShowEmojis(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showEmojis]);

  // Close user menu when clicking outside
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

  const iCanMod = session?.user?.isAdmin || Boolean((session?.user as Record<string,unknown>)?.isMod);

  const handleTip = useCallback(async () => {
    if (!userMenu || !tipAmount) return;
    setTipping(true); setTipMsg(null);
    try {
      await apiClient.post(`/users/${userMenu.userId}/tip`, { amount: Number(tipAmount) });
      setTipMsg(`✓ ${tipAmount} ⚜ envoyés à ${userMenu.username}`);
      setTipAmount('');
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      setTipMsg(err?.response?.data?.error ?? 'Erreur');
    } finally { setTipping(false); }
  }, [userMenu, tipAmount]);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const token = session?.user?.accessToken;
    connectSocket(token);
    const s = getSocket(token);

    const onConnect    = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onGlobalChat = (msg: ChatMsg) =>
      setMessages(prev => {
        const next = [...prev, msg];
        return next.length > 100 ? next.slice(-100) : next;
      });
    const onOnlineCount = (count: number) => setOnlineCount(count);
    const onChatMuted = (d: { until: string }) => setMutedUntil(new Date(d.until));
    const onChatUnmuted = () => setMutedUntil(null);
    const onChatSystem = (d: { message: string }) =>
      setMessages(prev => [...prev, { id: `sys_${Date.now()}`, userId: 'system', username: 'Système', avatar: null, coins: 0, level: 0, tier: 'bronze', isAdmin: false, isMod: false, isPartner: false, message: d.message, timestamp: new Date().toISOString() }]);

    s.on('connect',     onConnect);
    s.on('disconnect',  onDisconnect);
    s.on('globalChat',  onGlobalChat);
    s.on('onlineCount', onOnlineCount);
    s.on('chatMuted',   onChatMuted);
    s.on('chatUnmuted', onChatUnmuted);
    s.on('chatSystem',  onChatSystem);
    if (s.connected) setConnected(true);

    return () => {
      s.off('connect',     onConnect);
      s.off('disconnect',  onDisconnect);
      s.off('globalChat',  onGlobalChat);
      s.off('onlineCount', onOnlineCount);
      s.off('chatMuted',   onChatMuted);
      s.off('chatUnmuted', onChatUnmuted);
      s.off('chatSystem',  onChatSystem);
    };
  }, [session?.user?.accessToken]);

  useEffect(() => {
    if (hydrated) {
      try { sessionStorage.setItem('chat_history', JSON.stringify(messages.slice(-50))); } catch {}
    }
    scrollToBottom();
  }, [messages, scrollToBottom, hydrated]);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text || !session || !connected) return;
    getSocket().emit('globalChat', { message: text });
    setInput('');
    inputRef.current?.focus();
  }, [input, session, connected]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const insertEmoji = useCallback((emoji: string) => {
    setInput(prev => (prev + emoji).slice(0, 200));
    setShowEmojis(false);
    inputRef.current?.focus();
  }, []);

  return (
    <aside
      className="flex flex-col shrink-0"
      style={{ width: 280, minWidth: 280, background: '#0a0817', borderLeft: '1px solid #1e1a30' }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b"
        style={{ background: '#07060f', borderColor: '#1e1a30' }}
      >
        <div className="flex items-center gap-2">
          {/* Site name like BLITZ */}
          <span className="font-bold text-[13px] tracking-wider text-[#d4a017] uppercase" style={{ fontFamily: 'Cinzel, serif', letterSpacing: '0.15em' }}>
            AoM
          </span>
          <span className="text-[#3d3860] text-[11px]">/</span>
          <span className="text-[#c8c0e0] text-[11px] font-medium">Chat</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className={cn('w-1.5 h-1.5 rounded-full', connected ? 'bg-emerald-400' : 'bg-[#3d3860]')} />
          <span className="text-emerald-400 text-[11px] font-medium tabular-nums">{onlineCount}</span>
          <Users size={11} className="text-[#3d3860]" />
        </div>
      </div>

      {/* Messages */}
      <div
        className="flex-1 overflow-y-auto min-h-0 py-1"
        style={{ scrollbarWidth: 'thin', scrollbarColor: '#2d2850 transparent' }}
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2">
            <div className="w-8 h-8 rounded-full bg-[#13111f] flex items-center justify-center">
              <Users size={14} className="text-[#3d3860]" />
            </div>
            <p className="text-[11px] text-[#3d3860] text-center">
              {connected ? t('chat_no_messages') : t('roulette_connecting')}
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isMe    = msg.userId === session?.user?.id;
            const isSystem = msg.userId === 'system';
            const bgColor = avatarColor(msg.username);
            const color   = levelColor(msg.tier);

            if (isSystem) return (
              <div key={msg.id} className="px-3 py-1.5 text-center">
                <span className="text-[10px] italic" style={{ color: '#4a4468' }}>{msg.message}</span>
              </div>
            );

            return (
              <div
                key={msg.id}
                className={cn(
                  'group flex items-start gap-3 px-3 py-3 transition-colors cursor-default',
                  isMe ? 'bg-[#d4a017]/5' : 'hover:bg-[#0d0c18]'
                )}
              >
                <button
                  className="shrink-0 relative cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={(e) => {
                    if (isMe) return;
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    setUserMenu({ userId: msg.userId, username: msg.username, avatar: msg.avatar, isAdmin: msg.isAdmin, x: rect.right + 4, y: rect.top });
                    setTipAmount(''); setTipMsg(null);
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center text-[12px] font-bold text-white"
                    style={{ background: msg.avatar ? 'transparent' : bgColor, border: `2px solid ${color}55` }}
                  >
                    {msg.avatar
                      ? <img src={msg.avatar} alt={msg.username} className="w-full h-full object-cover" />
                      : msg.username.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="absolute -bottom-1 -right-1 text-[9px] font-black rounded-full flex items-center justify-center"
                    style={{ background: color, color: '#07060f', width: 16, height: 16, lineHeight: 1 }}>
                    {msg.level}
                  </div>
                </button>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className={cn('text-[13px] font-bold leading-none', isMe ? 'text-[#d4a017]' : 'text-[#e8e2f5]')}>
                      {msg.username}
                    </span>
                    {msg.isAdmin && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#be123c33', color: '#f87171', border: '1px solid #be123c55' }}>ADMIN</span>
                    )}
                    {msg.isMod && !msg.isAdmin && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#1e3a5f', color: '#60a5fa', border: '1px solid #3b82f640' }}>MOD</span>
                    )}
                    {msg.isPartner && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ background: '#2d1b4e', color: '#c084fc', border: '1px solid #a855f740' }}>PARTNER</span>
                    )}
                    <span className="text-[10px] text-[#3d3860] opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                  <p className="text-[13px] text-[#9990b8] leading-snug break-words">{renderMessage(msg.message)}</p>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t" style={{ borderColor: '#1e1a30', background: '#07060f' }}>
        {session ? (
          <>
            {mutedUntil && mutedUntil > new Date() ? (
              <div className="px-3 py-3 text-center">
                <VolumeX size={14} className="mx-auto mb-1" style={{ color: '#f87171' }} />
                <p className="text-[11px] text-red-400">
                  Muté jusqu'à {mutedUntil.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ) : (
              <>
                <div className="px-3 py-2">
                  <div className="flex items-center gap-2 rounded-lg px-3 h-9"
                    style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                    <input
                      ref={inputRef}
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder={t('chat_placeholder')}
                      maxLength={200}
                      disabled={!connected}
                      className="flex-1 bg-transparent text-[12px] text-[#c8c0e0] placeholder:text-[#3d3860] outline-none border-none"
                    />
                    <button
                      onClick={handleSend}
                      disabled={!input.trim() || !connected}
                      className="w-6 h-6 rounded flex items-center justify-center shrink-0 disabled:opacity-30 transition-all hover:scale-110"
                      style={{ background: input.trim() ? '#d4a017' : 'transparent' }}
                    >
                      <Send size={11} style={{ color: input.trim() ? '#07060f' : '#3d3860' }} />
                    </button>
                  </div>
                </div>
                {/* Emoji picker popup */}
                <div className="relative px-3 pb-2" ref={emojiRef}>
                  <div className="flex items-center justify-between">
                    <button
                      onClick={() => setShowEmojis(v => !v)}
                      className={cn('transition-colors', showEmojis ? 'text-[#d4a017]' : 'text-[#3d3860] hover:text-[#6b6488]')}
                    >
                      <Smile size={14} />
                    </button>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[#d4a017] text-[11px] font-bold">⚜</span>
                      <span className="text-[#d4a017] text-[11px] font-bold tabular-nums">
                        {new Intl.NumberFormat('fr-FR').format(session.user.coins)}
                      </span>
                    </div>
                  </div>

                  {showEmojis && (
                    <div
                      className="absolute bottom-full left-0 mb-1 rounded-xl overflow-hidden shadow-2xl"
                      style={{ width: 260, background: '#0d0b1a', border: '1px solid #1e1a30', zIndex: 200 }}
                    >
                      {/* Custom image emojis */}
                      {CUSTOM_EMOJIS.length > 0 && (
                        <div className="grid grid-cols-7 gap-0.5 px-2 py-2">
                          {CUSTOM_EMOJIS.map(e => (
                            <button
                              key={e.name}
                              onClick={() => insertEmoji(`:${e.name}:`)}
                              className="w-8 h-8 rounded flex items-center justify-center hover:bg-white/10 transition-colors"
                              title={e.name}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={`/emojis/${e.file}`} alt={e.name} className="w-6 h-6 object-contain" />
                            </button>
                          ))}
                        </div>
                      )}
                      {CUSTOM_EMOJIS.length === 0 && (
                        <div className="px-3 py-4 text-center text-[10px] text-[#4a4570]">Aucun emoji disponible</div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="px-3 py-3 text-center">
            <p className="text-[11px] text-[#3d3860] leading-relaxed">
              <span className="text-[#d4a017] font-semibold">{t('chat_signin_prompt')}</span>
              <br />{t('chat_signin_desc')}
            </p>
          </div>
        )}
      </div>

      {/* Mute duration picker (mod/admin — click on message) */}
      {/* User context menu */}
      {userMenu && (
        <div
          ref={menuRef}
          className="fixed z-[400] rounded-xl shadow-2xl overflow-hidden"
          style={{ left: Math.min(userMenu.x, window.innerWidth - 200), top: Math.min(userMenu.y, window.innerHeight - 250), width: 188, background: '#0d0b1a', border: '1px solid #1e1a30' }}
        >
          {/* User header */}
          <div className="flex items-center gap-2 px-3 py-2.5 border-b" style={{ borderColor: '#1e1a30' }}>
            <div className="w-7 h-7 rounded-full overflow-hidden shrink-0" style={{ background: '#1e1a30' }}>
              {userMenu.avatar && <img src={userMenu.avatar} alt={userMenu.username} className="w-full h-full object-cover" />}
            </div>
            <span className="text-[12px] font-bold text-[#e8e2f5] truncate">{userMenu.username}</span>
          </div>

          {/* Profile */}
          <a
            href={`/profile?id=${userMenu.userId}`}
            className="flex items-center gap-2.5 px-3 py-2 text-[12px] text-[#c8c0e0] hover:bg-[#13111f] transition-colors"
            onClick={() => setUserMenu(null)}
          >
            <User size={13} className="text-[#6b6488]" /> Voir le profil
          </a>

          {/* Tip */}
          {session && (
            <div className="px-3 py-2 border-t" style={{ borderColor: '#1e1a30' }}>
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[11px] text-[#d4a017]">⚜</span>
                <span className="text-[11px] text-[#c8c0e0]">Envoyer des coins</span>
              </div>
              <div className="flex gap-1.5">
                <input
                  type="number" min={10} max={10000}
                  value={tipAmount}
                  onChange={e => setTipAmount(e.target.value)}
                  placeholder="10"
                  className="flex-1 w-0 rounded px-2 py-1 text-[11px] text-[#e8e2f5] outline-none"
                  style={{ background: '#13111f', border: '1px solid #1e1a30' }}
                />
                <button
                  onClick={handleTip}
                  disabled={tipping || !tipAmount}
                  className="px-2 py-1 rounded text-[11px] font-bold disabled:opacity-40 transition-opacity"
                  style={{ background: '#d4a017', color: '#07060f' }}
                >
                  {tipping ? '…' : 'Tip'}
                </button>
              </div>
              {tipMsg && <p className={cn('text-[10px] mt-1', tipMsg.startsWith('✓') ? 'text-green-400' : 'text-red-400')}>{tipMsg}</p>}
            </div>
          )}

          {/* Mute — mod/admin only */}
          {iCanMod && !userMenu.isAdmin && (
            <button
              onClick={() => { setMuteTarget({ userId: userMenu.userId, username: userMenu.username }); setUserMenu(null); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-[12px] text-red-400 hover:bg-[#13111f] transition-colors border-t"
              style={{ borderColor: '#1e1a30' }}
            >
              <VolumeX size={13} /> Muter
            </button>
          )}
        </div>
      )}

      {muteTarget && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setMuteTarget(null)}>
          <div className="rounded-xl p-5 w-64" style={{ background: '#0d0b1a', border: '1px solid #3b82f640' }}
            onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-[13px] mb-1 flex items-center gap-2" style={{ color: '#60a5fa' }}>
              <VolumeX size={14} /> Muter {muteTarget.username}
            </h3>
            <p className="text-[11px] mb-3" style={{ color: '#6b6488' }}>Durée du mute</p>
            <div className="grid grid-cols-3 gap-1.5 mb-4">
              {[5, 15, 60, 360, 1440, 10080].map(min => (
                <button key={min} onClick={() => setMuteDuration(min)}
                  className="py-1.5 rounded text-[10px] font-bold transition-all"
                  style={{
                    background: muteDuration === min ? '#1e3a5f' : '#13111f',
                    border: `1px solid ${muteDuration === min ? '#3b82f6' : '#1e1a30'}`,
                    color: muteDuration === min ? '#60a5fa' : '#6b6488',
                  }}>
                  {min < 60 ? `${min}m` : min < 1440 ? `${min/60}h` : min === 1440 ? '24h' : '7j'}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button onClick={() => setMuteTarget(null)} className="flex-1 py-2 rounded text-[11px]" style={{ background: '#13111f', border: '1px solid #1e1a30', color: '#6b6488' }}>{t('common_close')}</button>
              <button onClick={() => {
                getSocket().emit('muteUser', { userId: muteTarget.userId, durationMinutes: muteDuration });
                setMuteTarget(null);
              }} className="flex-1 py-2 rounded text-[11px] font-bold" style={{ background: '#3b82f6', color: '#fff' }}>
                Muter
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
