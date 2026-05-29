'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Headphones, Mail, MessageCircle, ChevronRight, Hexagon, Send,
  AlertTriangle, CheckCircle2, ExternalLink,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { openSupportTicket } from '@/lib/api';

const CATEGORIES = [
  { value: 'deposit',  label: 'Dépôt non crédité' },
  { value: 'withdraw', label: 'Retrait bloqué'    },
  { value: 'bet',      label: 'Problème de pari'  },
  { value: 'account',  label: 'Compte / sécurité' },
  { value: 'other',    label: 'Autre'             },
];

const QUICK_LINKS = [
  { href: '/how-it-works',      label: 'Comment ça marche',  desc: 'Guide complet du parcours utilisateur' },
  { href: '/fairness',          label: 'Provably fair',       desc: 'Comment on garantit la transparence' },
  { href: '/responsible-gaming',label: 'Jeu responsable',     desc: 'Outils, limites, structures d\'aide' },
  { href: '/terms',             label: 'Conditions d\'utilisation', desc: 'Le cadre légal complet' },
];

export default function SupportPage() {
  const [subject, setSubject]   = useState('');
  const [category, setCategory] = useState('other');
  const [message, setMessage]   = useState('');
  const [posting, setPosting]   = useState(false);
  const [result, setResult]     = useState<{ ticketId: string } | null>(null);
  const [error, setError]       = useState<string | null>(null);

  const disabled = !subject || !message || message.length < 20 || posting;

  async function handleSubmit() {
    setPosting(true); setError(null);
    const fullSubject = `[${category}] ${subject}`;
    const response = await openSupportTicket({ subject: fullSubject, message });
    if ('error' in response) {
      setError(response.error);
    } else {
      setResult({ ticketId: response.id });
      setSubject(''); setMessage(''); setCategory('other');
    }
    setPosting(false);
  }

  return (
    <div className="relative pb-20">
      <Header />

      <section className="max-w-5xl mx-auto px-6 mt-10 grid lg:grid-cols-[1fr_280px] gap-8">

        <div className="space-y-6">
          <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-6 md:p-8 space-y-5">
            <div>
              <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright mb-1">
                Nouveau ticket
              </p>
              <h2 className="font-display font-bold text-2xl text-tft-text">
                Décris-nous ton problème
              </h2>
              <p className="text-sm text-tft-text-dim mt-1">
                Plus tu donnes de contexte (montants, IDs de pari, captures d&apos;écran), plus vite on
                peut t&apos;aider. Réponse moyenne : 15 min en semaine, &lt; 2 h le week-end.
              </p>
            </div>

            {result ? (
              <div className="rounded-md border border-tft-mint/40 bg-tft-mint/10 p-4 flex items-start gap-3">
                <CheckCircle2 size={18} className="text-tft-mint shrink-0 mt-0.5" />
                <div>
                  <p className="text-tft-mint font-semibold text-sm">
                    Ticket #{result.ticketId} créé
                  </p>
                  <p className="text-xs text-tft-text-dim mt-1">
                    Tu recevras une notification dès qu&apos;un membre du support répond. Tu peux suivre
                    l&apos;avancement depuis ton profil.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <label htmlFor="category" className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-2">
                    Catégorie
                  </label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {CATEGORIES.map((c) => (
                      <button
                        key={c.value}
                        onClick={() => setCategory(c.value)}
                        className={cn(
                          'px-3 py-2 rounded-md font-ui text-[12px] text-left transition-all cursor-pointer',
                          category === c.value
                            ? 'bg-tft-purple/20 border border-tft-purple-bright text-tft-purple-bright'
                            : 'bg-tft-bg border border-tft-border text-tft-text-dim hover:text-tft-text hover:border-tft-purple/40',
                        )}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label htmlFor="subject" className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-2">
                    Sujet
                  </label>
                  <input
                    id="subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value.slice(0, 120))}
                    placeholder="Résumé en une ligne"
                    className="w-full px-4 py-3 rounded-md bg-tft-bg border border-tft-border text-tft-text focus:outline-none focus:border-tft-purple-bright focus:ring-2 focus:ring-tft-purple/30 transition-colors"
                  />
                </div>

                <div>
                  <label htmlFor="message" className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted block mb-2">
                    Description ({message.length}/2000 caractères)
                  </label>
                  <textarea
                    id="message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                    rows={8}
                    placeholder={`Décris le problème en détail.\n\nSi c'est un pari : précise le tournament ID + le bet ID (visibles dans ton profil).\nSi c'est un retrait : copie l'adresse de destination + le réseau.\nSi c'est un dépôt : la TX hash crypto si tu l'as.`}
                    className="w-full px-4 py-3 rounded-md bg-tft-bg border border-tft-border text-tft-text text-sm leading-relaxed focus:outline-none focus:border-tft-purple-bright focus:ring-2 focus:ring-tft-purple/30 transition-colors resize-none"
                  />
                  {message.length > 0 && message.length < 20 && (
                    <p className="text-[11px] text-tft-text-muted mt-1">Encore {20 - message.length} caractères minimum.</p>
                  )}
                </div>

                {error && (
                  <div className="rounded-md border border-tft-rose/40 bg-tft-rose/10 px-3 py-2 text-xs text-tft-rose-bright flex items-center gap-2">
                    <AlertTriangle size={14} />
                    {error}
                  </div>
                )}

                <button
                  onClick={handleSubmit}
                  disabled={disabled}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md font-ui font-semibold text-[12px] uppercase tracking-wider transition-all cursor-pointer',
                    disabled
                      ? 'bg-tft-bg-elevated border border-tft-border text-tft-text-muted cursor-not-allowed'
                      : 'bg-gradient-rose shadow-rose-md text-white hover:shadow-arcane-md',
                  )}
                >
                  <Send size={14} />
                  {posting ? 'Envoi…' : 'Envoyer le ticket'}
                </button>
              </>
            )}
          </div>

          <div className="rounded-xl border border-tft-border bg-card-arcane p-5 flex items-center gap-4">
            <div className="shrink-0 w-12 h-12 rounded-md bg-tft-cyan-dim border border-tft-cyan/40 flex items-center justify-center">
              <MessageCircle size={20} className="text-tft-cyan-bright" />
            </div>
            <div className="flex-1">
              <p className="font-display font-semibold text-tft-text">Préfères Discord ?</p>
              <p className="text-xs text-tft-text-dim">
                Notre canal #support est ouvert 7j/7. Réponse souvent plus rapide que le ticket pour
                les questions urgentes.
              </p>
            </div>
            <a
              href="https://discord.gg/tftmoney"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-md bg-tft-purple/20 border border-tft-purple/50 hover:border-tft-purple-bright font-ui text-xs uppercase tracking-wider text-tft-purple-bright transition-colors cursor-pointer"
            >
              Discord
              <ExternalLink size={11} />
            </a>
          </div>
        </div>

        <aside className="lg:sticky lg:top-20 lg:self-start space-y-4">
          <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-5">
            <div className="flex items-center gap-2 mb-3">
              <Mail size={14} className="text-tft-cyan-bright" />
              <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">Email direct</p>
            </div>
            <a
              href="mailto:support@tft.money"
              className="font-ui font-semibold text-base text-tft-cyan-bright hover:underline break-all"
            >
              support@tft.money
            </a>
            <p className="text-[11px] text-tft-text-muted mt-2 leading-relaxed">
              Pour les demandes hors-compte (presse, partenariats, légal).
            </p>
          </div>

          <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-5">
            <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright mb-3">
              Avant d&apos;ouvrir un ticket
            </p>
            <ul className="space-y-2.5">
              {QUICK_LINKS.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="flex items-center justify-between gap-3 group cursor-pointer"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-tft-text group-hover:text-tft-purple-bright transition-colors truncate">{l.label}</p>
                      <p className="text-[11px] text-tft-text-muted truncate">{l.desc}</p>
                    </div>
                    <ChevronRight size={14} className="text-tft-text-muted group-hover:text-tft-purple-bright transition-colors shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </aside>

      </section>
    </div>
  );
}

function Header() {
  return (
    <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
      <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-5xl mx-auto px-6 py-16 md:py-20 space-y-5">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-cyan/40 bg-tft-cyan-dim">
          <Headphones size={11} className="text-tft-cyan-bright" />
          <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright">
            Support · 7j/7
          </span>
        </div>
        <h1 className="font-display font-bold text-4xl md:text-5xl text-tft-text leading-tight">
          On est là pour toi
        </h1>
        <p className="text-tft-text-dim text-base max-w-2xl">
          Ouvre un ticket, écris-nous en email ou ping-nous sur Discord. Réponse moyenne sous 15 min
          en semaine, &lt; 2 h le week-end. <span className="text-tft-text">Toutes les demandes sont prises au sérieux.</span>
        </p>
      </div>
    </section>
  );
}
