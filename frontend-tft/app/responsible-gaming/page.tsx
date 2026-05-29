'use client';

import Link from 'next/link';
import { Heart, Clock, ShieldCheck, AlertCircle, Phone, ExternalLink, ChevronRight } from 'lucide-react';

const LIMITS = [
  {
    icon: Clock,
    title: 'Time-out',
    body: 'Suspends ton compte pendant 24 h, 7 jours ou 30 jours. Pas d\'accès aux paris, aux dépôts, à la roulette ou aux mini-jeux pendant la période choisie.',
  },
  {
    icon: ShieldCheck,
    title: 'Auto-exclusion',
    body: 'Fermeture permanente du compte. Aucune reconnexion possible avec le même Steam ID, même après une demande de support. Choix irréversible.',
  },
  {
    icon: AlertCircle,
    title: 'Plafond de mise',
    body: 'Fixe un montant maximum de mise par pari (10 ◈, 50 ◈, 100 ◈, ...). Les paris au-dessus du plafond sont bloqués côté serveur, pas juste côté UI.',
  },
];

const HOTLINES = [
  { region: 'France',  name: 'Joueurs Info Service',     phone: '09 74 75 13 13', url: 'https://www.joueurs-info-service.fr' },
  { region: 'Belgique', name: 'BeAlert',                 phone: '0800 35 777',     url: 'https://www.bealert.be' },
  { region: 'Québec',   name: 'Jeu : aide et référence',  phone: '1 800 461-0140',  url: 'https://aidejeu.ca' },
  { region: 'Suisse',  name: 'Sos-Jeu',                   phone: '0800 040 080',    url: 'https://www.sos-jeu.ch' },
];

export default function ResponsibleGamingPage() {
  return (
    <div className="relative">
      <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
        <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

        <div className="relative max-w-4xl mx-auto px-6 py-20 md:py-28 space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-tft-rose/40 bg-tft-rose/10">
            <Heart size={11} className="text-tft-rose-bright" />
            <span className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-rose-bright">
              Jeu responsable
            </span>
          </div>
          <h1 className="font-display font-bold text-4xl md:text-5xl text-tft-text leading-tight">
            tft.money est conçu pour le divertissement
          </h1>
          <p className="text-tft-text-dim text-lg max-w-2xl leading-relaxed">
            Parier doit rester une expérience plaisante — pas une obligation, pas une fuite,
            pas un investissement. Cette page explique les outils qu&apos;on met à ta disposition
            pour garder le contrôle, et où chercher de l&apos;aide si tu en as besoin.
          </p>
        </div>
      </section>

      <section className="max-w-4xl mx-auto px-6 py-16 space-y-14">
        <div>
          <div className="text-center mb-10 space-y-2">
            <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-purple-bright">
              Outils disponibles
            </p>
            <h2 className="font-display font-bold text-3xl md:text-4xl text-tft-text">
              Garde-fous intégrés
            </h2>
            <p className="text-tft-text-dim text-base max-w-xl mx-auto pt-2">
              Tout est configurable depuis ton profil — pas besoin de contacter le support
              pour activer ou ajuster une limite.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-5">
            {LIMITS.map((l) => (
              <div key={l.title} className="p-5 rounded-xl border border-tft-border bg-tft-bg-card/60">
                <div className="w-10 h-10 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center mb-3">
                  <l.icon size={18} className="text-tft-purple-bright" />
                </div>
                <h3 className="font-display font-semibold text-lg text-tft-text mb-2">{l.title}</h3>
                <p className="text-sm text-tft-text-dim leading-relaxed">{l.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 text-center">
            <Link
              href="/profile"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-tft-bg-card border border-tft-border hover:border-tft-purple/60 font-ui text-[12px] uppercase tracking-wider text-tft-text-dim hover:text-tft-text transition-colors cursor-pointer"
            >
              Configurer mes limites
              <ChevronRight size={14} />
            </Link>
          </div>
        </div>

        <div className="rounded-xl border border-tft-border bg-card-arcane p-6 md:p-8 space-y-4">
          <h3 className="font-display font-semibold text-xl text-tft-text">
            Signaux qui doivent t&apos;alerter
          </h3>
          <ul className="space-y-2 text-sm text-tft-text-dim">
            <li className="flex items-start gap-2"><span className="text-tft-rose-bright mt-1">▸</span> Parier de l&apos;argent qui devait servir à autre chose (loyer, courses, factures)</li>
            <li className="flex items-start gap-2"><span className="text-tft-rose-bright mt-1">▸</span> Augmenter les mises pour ressentir le même plaisir qu&apos;avant</li>
            <li className="flex items-start gap-2"><span className="text-tft-rose-bright mt-1">▸</span> Penser au prochain pari pendant le travail, les repas, le sommeil</li>
            <li className="flex items-start gap-2"><span className="text-tft-rose-bright mt-1">▸</span> Mentir à son entourage sur ses pertes</li>
            <li className="flex items-start gap-2"><span className="text-tft-rose-bright mt-1">▸</span> Essayer de récupérer ses pertes en pariant plus</li>
          </ul>
          <p className="text-sm text-tft-text-muted leading-relaxed pt-2">
            Si tu te reconnais dans 2 ou plus de ces signes, parle à un proche ou contacte une
            structure d&apos;aide en bas de page. C&apos;est gratuit, confidentiel et sans jugement.
          </p>
        </div>

        <div>
          <div className="text-center mb-8 space-y-2">
            <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-cyan-bright">
              Structures d&apos;aide
            </p>
            <h2 className="font-display font-bold text-3xl text-tft-text">
              Lignes d&apos;écoute francophones
            </h2>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {HOTLINES.map((h) => (
              <div key={h.region} className="p-5 rounded-xl border border-tft-border bg-tft-bg-card/60">
                <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted mb-1">{h.region}</p>
                <h3 className="font-display font-semibold text-base text-tft-text mb-2">{h.name}</h3>
                <div className="flex items-center gap-2 text-tft-mint mb-1">
                  <Phone size={13} />
                  <span className="font-ui font-semibold text-sm tabular-nums">{h.phone}</span>
                </div>
                <a
                  href={h.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-tft-cyan-bright hover:underline inline-flex items-center gap-1"
                >
                  {h.url.replace('https://', '')}
                  <ExternalLink size={10} />
                </a>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-tft-mint/30 bg-tft-mint/5 p-6 text-center">
          <p className="font-ui text-[11px] tracking-[0.22em] uppercase text-tft-mint mb-2">
            18+ uniquement
          </p>
          <p className="text-sm text-tft-text-dim max-w-xl mx-auto leading-relaxed">
            tft.money est strictement réservé aux personnes majeures. Si tu as moins de 18 ans
            ou si tu connais quelqu&apos;un qui en a et qui utilise la plateforme, contacte le
            support immédiatement — on bloque le compte et on rembourse les éventuels dépôts.
          </p>
        </div>
      </section>
    </div>
  );
}
