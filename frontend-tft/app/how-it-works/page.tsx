'use client';

import Link from 'next/link';
import {
  Hexagon, Coins, Trophy, ShieldCheck, Zap, Sparkles, ChevronRight,
  ArrowRight, LineChart, Lock, Eye,
} from 'lucide-react';

const STEPS = [
  {
    n: '01',
    icon: Sparkles,
    title: 'Crée ton compte avec Steam',
    body: 'Un clic sur "Se connecter avec Steam" et c\'est plié — pas d\'email à saisir, pas de mot de passe à retenir. Steam OpenID vérifie ton identité ; on récupère juste ton pseudo et ton avatar, rien d\'autre.',
  },
  {
    n: '02',
    icon: Coins,
    title: 'Approvisionne en crypto',
    body: 'BTC, ETH, USDT, LTC ou SOL. On affiche une adresse et un QR code, tu envoies ce que tu veux. Les coins ◈ apparaissent sur ton compte en moins de 2 minutes après confirmation réseau. Pas de minimum, pas de KYC tant que tu restes sous 1 000 $/mois.',
  },
  {
    n: '03',
    icon: Trophy,
    title: 'Parie sur les tournois TFT',
    body: 'Sélectionne le tacticien que tu penses voir gagner, fixe ta mise, valide. Le pari se ferme automatiquement au coup d\'envoi du bracket. Tu peux suivre le classement live dans ton onglet sans rafraîchir.',
  },
  {
    n: '04',
    icon: ArrowRight,
    title: 'Encaisse ton gain',
    body: 'Settlement automatique à la fin du tournoi. Si ton tactician finit 1er, le payout est crédité sous 10 minutes max. Tu peux retirer en crypto à tout moment, traité sous 5 min en moyenne.',
  },
];

const ODDS_FACTORS = [
  {
    icon: LineChart,
    label: 'Riot solo queue (60%)',
    body: 'On pulle les 20 derniers placements ranked TFT de chaque joueur via l\'API Riot officielle, en pondérant les games les plus récentes plus fort. Un Challenger qui spike les top 4 régulièrement aura toujours une côte serrée.',
  },
  {
    icon: Sparkles,
    label: 'Tier + LP (40%)',
    body: 'Le rank actuel (Master / Grandmaster / Challenger + LP) sert de base. Plus le LP est haut, plus le score initial est élevé. Un Grandmaster 800 LP démarre devant un Master 400 LP toutes choses égales par ailleurs.',
  },
];

const TRUST_BULLETS = [
  { icon: Lock,         text: 'Settlement basé sur les sources officielles Riot (CompeteTFT) — pas de jugement manuel sur l\'issue d\'un tournoi.' },
  { icon: Eye,          text: 'Toutes les odds sont calculées par le même algorithme déterministe — pas de favoritisme sur certains joueurs.' },
  { icon: ShieldCheck,  text: 'Forfait d\'un participant déclaré pendant le tournoi = remboursement intégral des paris le concernant.' },
  { icon: Zap,          text: 'Margin maison fixe à 8% — visible dans nos ToS, pas de surcharge cachée selon la côte.' },
];

export default function HowItWorksPage() {
  return (
    <div className="relative">
      <Hero />
      <StepsSection />
      <OddsExplainSection />
      <TrustSection />
      <FaqCta />
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
      <div className="absolute inset-0 bg-hex-grid opacity-15 animate-hex-pulse pointer-events-none" aria-hidden="true" />
      <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

      <div className="relative max-w-4xl mx-auto px-6 py-20 md:py-28 text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-purple/40 bg-tft-purple/10">
          <Hexagon size={11} className="text-tft-cyan-bright" />
          <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
            Guide complet
          </span>
        </div>
        <h1 className="font-display font-bold text-4xl md:text-6xl text-tft-text leading-tight">
          Comment fonctionne <span className="text-arcane">tft.money</span>
        </h1>
        <p className="text-tft-text-dim text-lg max-w-2xl mx-auto leading-relaxed">
          De la connexion Steam à ton premier payout — tout ce que tu dois savoir avant
          de placer ton premier pari sur la scène compétitive Teamfight Tactics.
        </p>
      </div>
    </section>
  );
}

function StepsSection() {
  return (
    <section className="relative py-20 md:py-24 border-b border-tft-border">
      <div className="max-w-5xl mx-auto px-6">
        <div className="text-center mb-14 space-y-2">
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
            Le parcours
          </p>
          <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
            4 étapes, environ 5 minutes
          </h2>
        </div>

        <div className="space-y-4">
          {STEPS.map((step, i) => (
            <div
              key={step.n}
              className="relative grid grid-cols-[auto_1fr] gap-5 md:gap-8 p-6 rounded-xl border border-tft-border bg-card-arcane hover:border-tft-purple/40 transition-colors"
            >
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center">
                  <step.icon size={20} className="text-tft-purple-bright" />
                </div>
                <span className="font-ui text-2xl font-bold text-tft-text-faint tabular-nums">{step.n}</span>
                {i < STEPS.length - 1 && (
                  <div className="w-px flex-1 bg-gradient-to-b from-tft-purple/40 to-transparent" />
                )}
              </div>
              <div className="min-w-0 pt-1">
                <h3 className="font-display font-semibold text-xl text-tft-text mb-2">{step.title}</h3>
                <p className="text-tft-text-dim text-sm leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OddsExplainSection() {
  return (
    <section className="relative py-20 md:py-24 border-b border-tft-border bg-tft-bg">
      <div className="absolute inset-0 bg-hex-grid-cyan opacity-[0.04] pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-5xl mx-auto px-6 space-y-12">
        <div className="text-center space-y-2">
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright">
            Sous le capot
          </p>
          <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
            Comment on calcule les côtes
          </h2>
          <p className="text-tft-text-dim text-base max-w-2xl mx-auto pt-2">
            Pour chaque tacticien d&apos;un tournoi, on calcule un score de force basé sur deux signaux,
            puis on convertit ça en probabilités via un softmax — au final on applique une margin
            maison de 8% pour obtenir les côtes affichées.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          {ODDS_FACTORS.map((f) => (
            <div key={f.label} className="p-6 rounded-xl border border-tft-border bg-tft-bg-card/60 backdrop-blur-sm">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-md bg-tft-cyan-dim border border-tft-cyan/40 flex items-center justify-center">
                  <f.icon size={18} className="text-tft-cyan-bright" />
                </div>
                <h3 className="font-display font-semibold text-base text-tft-text">{f.label}</h3>
              </div>
              <p className="text-sm text-tft-text-dim leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-tft-purple/40 bg-card-arcane p-6 md:p-8">
          <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-purple-bright mb-2">
            En clair, sur un exemple
          </p>
          <p className="text-tft-text-dim text-sm leading-relaxed mb-4">
            Sur le TFT Set Championship, Setsuko (Challenger 845 LP, avg placement 3.1 sur 20 games)
            sortira typiquement avec une côte de <span className="text-tft-purple-bright font-semibold">3.20×</span> —
            soit ~28% de chance de winner. À l&apos;autre bout du bracket, Outsider (Master 200 LP, avg 4.8)
            sera autour de <span className="text-tft-purple-bright font-semibold">17.00×</span>, soit ~5%. La somme des
            probabilités implicites sur tout le bracket fait <span className="text-tft-gold-bright font-semibold">1.08</span> —
            c&apos;est notre overround de 8%.
          </p>
          <p className="text-tft-text-muted text-xs leading-relaxed">
            On recalcule toutes les 30 min jusqu&apos;au coup d&apos;envoi du bracket. Une fois que le bracket
            commence, les côtes sont gelées — fini les changements de dernière minute.
          </p>
        </div>
      </div>
    </section>
  );
}

function TrustSection() {
  return (
    <section className="relative py-20 md:py-24 border-b border-tft-border">
      <div className="max-w-4xl mx-auto px-6">
        <div className="text-center mb-12 space-y-2">
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
            Ce qui te protège
          </p>
          <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
            Quatre garde-fous
          </h2>
        </div>

        <div className="space-y-3">
          {TRUST_BULLETS.map((b, i) => (
            <div key={i} className="flex items-start gap-4 p-5 rounded-xl border border-tft-border bg-tft-bg-card/60">
              <div className="shrink-0 w-9 h-9 rounded-md bg-tft-mint/15 border border-tft-mint/40 flex items-center justify-center">
                <b.icon size={16} className="text-tft-mint" />
              </div>
              <p className="text-sm text-tft-text-dim leading-relaxed pt-1.5">{b.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FaqCta() {
  return (
    <section className="relative py-20 md:py-24 overflow-hidden">
      <div className="absolute inset-0 bg-hero-arcane opacity-90" aria-hidden="true" />
      <div className="absolute inset-0 bg-hex-grid opacity-10 animate-hex-pulse" aria-hidden="true" />
      <div className="relative max-w-2xl mx-auto px-6 text-center space-y-5">
        <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
          Une question pas couverte ?
        </h2>
        <p className="text-tft-text-dim text-base">
          Notre équipe répond en moyenne sous 15 min en ticket ou sur Discord — sept jours sur sept.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center pt-2">
          <Link
            href="/support"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/60 font-ui text-[12px] uppercase tracking-wider text-tft-text-dim hover:text-tft-text transition-colors cursor-pointer"
          >
            Ouvrir un ticket
            <ChevronRight size={14} />
          </Link>
          <Link
            href="/tournaments"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-md bg-gradient-rose shadow-rose-md font-ui font-semibold text-[12px] uppercase tracking-wider text-white hover:shadow-arcane-md transition-all cursor-pointer"
          >
            Voir les tournois
            <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}
