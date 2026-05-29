'use client';

import Link from 'next/link';
import { Hexagon, Users, Trophy, ChevronRight, Info } from 'lucide-react';

/**
 * /matches — TFT n'a pas de matchs 1v1 comme AoE. On explique le format
 * lobby 8 joueurs et on redirige vers /tournaments. Page courte mais
 * brandée plutôt qu'un redirect dur — meilleur SEO et utilisateurs qui
 * tapent l'URL directement comprennent pourquoi.
 */
export default function MatchesPage() {
  return (
    <div className="relative">
      <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
        <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

        <div className="relative max-w-4xl mx-auto px-6 py-20 md:py-28 text-center space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-cyan/40 bg-tft-cyan-dim">
            <Info size={11} className="text-tft-cyan-bright" />
            <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright">
              Format TFT
            </span>
          </div>
          <h1 className="font-display font-bold text-4xl md:text-5xl text-tft-text leading-tight">
            Pourquoi pas de matchs 1v1 ?
          </h1>
          <p className="text-tft-text-dim text-lg max-w-2xl mx-auto leading-relaxed">
            Teamfight Tactics est un auto-battler à 8 joueurs — pas un duel. Les tournois compétitifs
            se jouent en lobbies de 8 où chacun affronte les 7 autres en parallèle pendant ~30 minutes.
            Du coup, on parie sur l&apos;issue du tournoi, pas sur des matchs individuels.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-5 mb-12">
          <FormatCard
            icon={Users}
            title="Lobby 8 joueurs"
            body="Chaque round, 4 joueurs forment des comps de champions ; le perdant prend des dégâts. Quand tu tombes à 0 HP, t'es éliminé. Le dernier debout remporte la lobby."
          />
          <FormatCard
            icon={Hexagon}
            title="Tournament-wide scoring"
            body="Les tournois sont une série de 6-10 lobbies de 8 où ton placement (1er = 8 pts, 2e = 7 pts, ...) cumule. Les Top X au score total avancent en finale."
          />
          <FormatCard
            icon={Trophy}
            title="Un seul vainqueur"
            body="À la fin du tournoi, un tacticien soulève le trophée. C'est cet outcome — le tournament winner — qui est notre marché principal sur tft.money."
          />
        </div>

        <div className="rounded-xl border border-tft-purple/40 bg-card-arcane p-6 md:p-8 text-center space-y-4">
          <p className="font-display font-semibold text-xl text-tft-text">
            Tous les paris se passent au niveau du tournoi
          </p>
          <p className="text-tft-text-dim text-sm max-w-xl mx-auto leading-relaxed">
            Direction la page des tournois pour voir ce qui est ouvert aux paris ce soir,
            les côtes et les participants de chaque event.
          </p>
          <div className="pt-2">
            <Link
              href="/tournaments"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-gradient-rose shadow-rose-md font-ui font-semibold text-[12px] uppercase tracking-wider text-white hover:shadow-arcane-md transition-all cursor-pointer"
            >
              Voir les tournois
              <ChevronRight size={14} />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

function FormatCard({ icon: Icon, title, body }: {
  icon: typeof Hexagon;
  title: string;
  body: string;
}) {
  return (
    <div className="p-5 rounded-xl border border-tft-border bg-tft-bg-card/60">
      <div className="w-10 h-10 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center mb-3">
        <Icon size={18} className="text-tft-purple-bright" />
      </div>
      <h3 className="font-display font-semibold text-lg text-tft-text mb-2">{title}</h3>
      <p className="text-sm text-tft-text-dim leading-relaxed">{body}</p>
    </div>
  );
}
