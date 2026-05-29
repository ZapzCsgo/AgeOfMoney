'use client';

import Link from 'next/link';
import { ShieldCheck, Hash, Eye, Database, ExternalLink, Lock, ChevronRight } from 'lucide-react';

const SOURCES = [
  {
    icon: Database,
    title: 'CompeteTFT',
    body: 'Plateforme officielle Riot pour les tournois TFT compétitifs. On poll les standings live toutes les 30 secondes pendant le bracket. Source primaire pour les payouts.',
    url: 'https://competetft.com',
  },
  {
    icon: Database,
    title: 'Liquipedia TFT',
    body: 'Wiki communautaire mis à jour par les éditeurs Liquipedia en direct pendant les tournois. Source secondaire — et source canonique pour le settlement final post-tournament.',
    url: 'https://liquipedia.net/tft',
  },
  {
    icon: Database,
    title: 'Riot Games API (TFT)',
    body: 'API officielle pour les stats ranked solo queue. On l\'utilise pour calculer les odds en amont (tier, LP, placement moyen), pas pour déterminer le résultat d\'un tournoi.',
    url: 'https://developer.riotgames.com/docs/tft',
  },
];

const PROVABLY_FAIR_STEPS = [
  {
    n: '01',
    title: 'Server seed généré à chaque round',
    body: 'Au début de chaque round de roulette ou coinflip, le serveur génère un seed aléatoire et publie son hash SHA-256 AVANT le tirage. Le hash est visible publiquement.',
  },
  {
    n: '02',
    title: 'Client seed que tu contrôles',
    body: 'Tu peux fournir ton propre client seed (caractères aléatoires) qui sera combiné au server seed. Si tu n\'en fournis pas, on en génère un côté navigateur.',
  },
  {
    n: '03',
    title: 'Tirage déterministe',
    body: 'Le résultat est calculé par HMAC-SHA256(server_seed, client_seed + nonce). Ni le serveur ni le joueur ne peuvent biaiser le tirage individuellement.',
  },
  {
    n: '04',
    title: 'Server seed révélé après le tirage',
    body: 'Une fois le round terminé, on publie le server seed. Tu peux re-calculer le HMAC à la main et vérifier que ça donne bien le résultat affiché.',
  },
];

export default function FairnessPage() {
  return (
    <div className="relative">
      <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
        <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

        <div className="relative max-w-4xl mx-auto px-6 py-20 md:py-28 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-mint/40 bg-tft-mint/10">
            <ShieldCheck size={11} className="text-tft-mint" />
            <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-mint">
              Provably fair
            </span>
          </div>
          <h1 className="font-display font-bold text-4xl md:text-5xl text-tft-text leading-tight">
            Aucun résultat n&apos;est entre nos mains
          </h1>
          <p className="text-tft-text-dim text-lg max-w-2xl leading-relaxed">
            Tout ce qu&apos;on fait sur tft.money est vérifiable indépendamment — soit cryptographiquement
            (mini-jeux), soit par recoupement avec des sources publiques officielles (paris esport).
            Cette page explique exactement comment.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 space-y-14">

        <div>
          <div className="text-center mb-10 space-y-2">
            <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright">
              Paris esport
            </p>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
              Sources officielles uniquement
            </h2>
            <p className="text-tft-text-dim text-base max-w-xl mx-auto pt-2">
              Pour les paris TFT, on ne décide jamais nous-mêmes qui gagne — on relit ce que les
              sources officielles publient et le settlement se fait automatiquement.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {SOURCES.map((s) => (
              <div key={s.title} className="p-5 rounded-xl border border-tft-border bg-tft-bg-card/60">
                <div className="w-10 h-10 rounded-md bg-tft-cyan-dim border border-tft-cyan/40 flex items-center justify-center mb-3">
                  <s.icon size={18} className="text-tft-cyan-bright" />
                </div>
                <h3 className="font-display font-semibold text-base text-tft-text mb-2">{s.title}</h3>
                <p className="text-sm text-tft-text-dim leading-relaxed mb-3">{s.body}</p>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-tft-cyan-bright hover:underline"
                >
                  {s.url.replace('https://', '')}
                  <ExternalLink size={10} />
                </a>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-xl border border-tft-mint/30 bg-tft-mint/5 p-5 flex items-start gap-3">
            <Eye size={18} className="text-tft-mint shrink-0 mt-0.5" />
            <p className="text-sm text-tft-text-dim leading-relaxed">
              Sur la page d&apos;un tournoi, le champ <span className="text-tft-mint font-semibold">Sync</span> en
              haut indique quelle source a fourni le classement le plus récent ainsi que l&apos;heure de
              la dernière mise à jour. Si CompeteTFT est temporairement indisponible, le fallback
              Liquipedia s&apos;active automatiquement.
            </p>
          </div>
        </div>

        <div>
          <div className="text-center mb-10 space-y-2">
            <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
              Mini-jeux
            </p>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
              Provably Fair cryptographique
            </h2>
            <p className="text-tft-text-dim text-base max-w-xl mx-auto pt-2">
              Pour la roulette, le coinflip et le jackpot, on utilise un système de hash SHA-256
              que tu peux re-calculer toi-même pour vérifier chaque tirage.
            </p>
          </div>

          <div className="space-y-4">
            {PROVABLY_FAIR_STEPS.map((s) => (
              <div key={s.n} className="grid grid-cols-[auto_1fr] gap-5 p-5 rounded-xl border border-tft-border bg-tft-bg-card/60">
                <div className="flex flex-col items-center gap-2 shrink-0">
                  <span className="font-ui text-2xl font-bold text-tft-purple-bright tabular-nums">{s.n}</span>
                  <Hash size={16} className="text-tft-text-faint" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-display font-semibold text-lg text-tft-text mb-1">{s.title}</h3>
                  <p className="text-sm text-tft-text-dim leading-relaxed">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-tft-purple/40 bg-card-arcane p-6 md:p-8 space-y-4">
          <div className="flex items-center gap-3">
            <Lock size={20} className="text-tft-purple-bright" />
            <h3 className="font-display font-semibold text-xl text-tft-text">
              Ce qu&apos;on ne peut PAS faire
            </h3>
          </div>
          <ul className="space-y-2 text-sm text-tft-text-dim pl-1">
            <li className="flex items-start gap-2"><span className="text-tft-mint mt-1">✓</span> Changer le résultat d&apos;un tirage roulette après que le hash a été publié</li>
            <li className="flex items-start gap-2"><span className="text-tft-mint mt-1">✓</span> Annuler un pari TFT légitime sans déclencher un refund équivalent</li>
            <li className="flex items-start gap-2"><span className="text-tft-mint mt-1">✓</span> Modifier les odds après que tu aies validé un pari (oddsAtBet est figé en DB)</li>
            <li className="flex items-start gap-2"><span className="text-tft-mint mt-1">✓</span> Empêcher un retrait de fonds gagnés légitimement</li>
          </ul>
          <p className="text-xs text-tft-text-muted leading-relaxed pt-2">
            Si tu suspectes un problème avec un settlement ou un tirage, ouvre un ticket support avec
            le bet ID ou le round ID — on te montre le hash, le seed, et le calcul vérifiable.
          </p>
        </div>

        <div className="text-center">
          <Link
            href="/support"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-md bg-gradient-rose shadow-rose-md font-ui font-semibold text-[12px] uppercase tracking-wider text-white hover:shadow-arcane-md transition-all cursor-pointer"
          >
            Signaler un problème
            <ChevronRight size={14} />
          </Link>
        </div>
      </section>
    </div>
  );
}
