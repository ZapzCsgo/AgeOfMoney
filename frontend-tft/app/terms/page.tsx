'use client';

import Link from 'next/link';
import { Shield, ChevronLeft } from 'lucide-react';

/**
 * Full-page version of the ToS — the Footer also surfaces these via a modal
 * for quick reads, but having a real /terms URL is needed for : (a) the
 * email signature footer link, (b) NOWPayments compliance review,
 * (c) Google indexing so we can prove "we have public terms" to any future
 * payment processor or sponsor.
 *
 * Content kept in sync with the modal in `components/layout/Footer.tsx`.
 * If you edit one, edit the other.
 */

const SECTIONS = [
  {
    title: '1. Acceptation',
    body: `En accédant aux Services proposés par tft.money ("Services"), l'Utilisateur certifie avoir au moins 18 ans et accepte d'être lié par ces Conditions d'Utilisation. Si tu n'acceptes pas ces conditions, ne crée pas de compte et ferme cette page.

L'inscription via Steam OpenID constitue une acceptation explicite des présentes conditions.`,
  },
  {
    title: '2. Monnaie virtuelle (◈)',
    body: `Tous les crédits affichés sur tft.money (coins ◈) n'ont aucune valeur monétaire réelle au sens juridique. Ils sont destinés au divertissement uniquement et représentent une licence d'utilisation des fonctionnalités du Service.

Le partage de compte, le transfert de coins entre comptes hors mécanismes officiels (tip, affiliate), et le multi-compte sont strictement interdits. Toute infraction entraîne un bannissement immédiat sans remboursement.`,
  },
  {
    title: '3. Dépôts et retraits crypto',
    body: `Les dépôts et retraits en cryptomonnaie sont définitifs. tft.money n'est pas responsable :
• Des transferts effectués sur un mauvais réseau
• Des pertes liées à une adresse de retrait erronée fournie par l'Utilisateur
• Des fluctuations du taux de change USD/crypto entre l'envoi et la réception

Taux de change appliqués : 1 USD = 1.69 ◈ (dépôt) / 1.69 ◈ = 0.99 USD (retrait). Cette marge couvre les frais réseau et la volatilité de marché.

Les retraits supérieurs à 1 000 USD/mois cumulés peuvent déclencher une vérification d'identité simplifiée (KYC light).`,
  },
  {
    title: '4. Paris esport (Tournament Winner TFT)',
    body: `Les côtes (odds) sont calculées automatiquement par notre moteur tftOddsEngine à partir des stats Riot solo queue (60%) et du tier ranked (40%) de chaque participant. Une margin maison de 8% est appliquée — visible dans la somme des probabilités implicites.

Les paris ferment automatiquement au début du bracket du tournoi (champ bracketStarted). Aucun pari ne peut être placé après cette cloche.

Un forfait, un no-show ou une disqualification d'un participant entraîne un remboursement intégral des paris le concernant.

Si un tournoi est annulé sans gagnant identifié dans les 24 heures suivant son endDate prévu, tous les paris en attente sont remboursés (état REFUNDED).`,
  },
  {
    title: '5. Mini-jeux (Roulette, Coinflip, Jackpot)',
    body: `Tous les mini-jeux utilisent un système Provably Fair vérifiable cryptographiquement (HMAC-SHA256 avec server seed + client seed). Voir /fairness pour les détails techniques.

Égalité (BO pairs sur paris match AoE) : les paris draw gagnent. Pour le BO2 specifically, un score 1-1 entraîne un remboursement des paris match (refund).`,
  },
  {
    title: '6. Jeu responsable',
    body: `Options d'auto-exclusion (24h, 7j, 30j ou permanente) et plafonds de mise configurables depuis /profile. Politique stricte 18+.

Voir /responsible-gaming pour la liste des structures d'aide francophones et les signaux d'addiction à reconnaître.

tft.money applique des mesures anti-abus automatiques (détection de comptes liés, monitoring des dépôts/retraits inhabituels) et peut suspendre un compte si un comportement suggère une perte de contrôle.`,
  },
  {
    title: '7. Non-affiliation à Riot Games',
    body: `tft.money n'est pas affilié, sponsorisé ou approuvé par Riot Games, Inc. ou par Tencent. Teamfight Tactics™ et tout contenu lié (noms de champions, art, marques) sont la propriété exclusive de Riot Games, Inc.

Nous opérons en tant que plateforme tierce de divertissement qui utilise des sources publiques (Liquipedia, CompeteTFT) pour suivre la scène esport TFT.`,
  },
  {
    title: '8. Limitation de responsabilité',
    body: `Le Service est fourni "tel quel". tft.money ne garantit pas un fonctionnement ininterrompu ou exempt d'erreurs.

L'utilisation des Services est aux risques exclusifs de l'Utilisateur. tft.money n'est pas responsable des dommages indirects, des fonds perdus suite à un piratage de compte Steam, ou des conséquences d'une mauvaise saisie d'adresse de retrait.

Le montant maximal de responsabilité de tft.money envers un Utilisateur est limité au solde de coins ◈ présent sur son compte à la date de l'incident, converti au taux de retrait en vigueur.`,
  },
  {
    title: '9. Code de conduite',
    body: `Sont strictement interdits :
• Toute activité illégale dans la juridiction de l'Utilisateur
• Le harcèlement, l'incitation à la haine, le doxxing dans le chat ou en DM
• L'utilisation de bots, scripts d'automatisation ou scrapers contre nos APIs
• Le multi-compte, le partage de compte, la vente ou la cession de compte
• La fraude au système d'affiliation (auto-parrainage, comptes fictifs)
• L'exploitation de bugs sans signalement préalable au support

Toute violation entraîne une suspension temporaire ou un bannissement permanent sans remboursement des coins en cours.`,
  },
  {
    title: '10. Confidentialité',
    body: `tft.money collecte le minimum d'informations nécessaire au fonctionnement du Service : pseudo Steam, ID Steam, avatar, adresse email optionnelle, historique des transactions.

Aucune donnée n'est revendue à des tiers. Les paiements transitent par NOWPayments (crypto) et MoonPay (carte) — voir leurs politiques de confidentialité respectives pour les détails.

Politique complète : voir le lien "Confidentialité" en bas de page.`,
  },
  {
    title: '11. Modifications',
    body: `tft.money se réserve le droit de modifier ces Conditions à tout moment. Les modifications substantielles seront annoncées via : (a) bannière sur la home page, (b) notification email aux utilisateurs ayant fourni une adresse, (c) post sur le Discord officiel.

L'utilisation continue du Service après une modification publiée vaut acceptation des nouvelles conditions.`,
  },
  {
    title: '12. Droit applicable',
    body: `Les présentes Conditions sont régies par le droit français. Tout litige sera soumis à la compétence exclusive des tribunaux français, sauf disposition impérative contraire en faveur du consommateur.

Pour toute réclamation préalable à une action judiciaire, contacter support@tft.money — la majorité des litiges se résolvent par échange direct sous 7 jours.`,
  },
];

export default function TermsPage() {
  return (
    <div className="relative">
      <section className="relative overflow-hidden bg-hero-arcane border-b border-tft-border">
        <div className="absolute inset-0 bg-hex-grid opacity-15 pointer-events-none" aria-hidden="true" />
        <div className="absolute -top-32 -left-20 w-[420px] h-[420px] rounded-full bg-tft-purple/15 blur-[120px]" aria-hidden="true" />

        <div className="relative max-w-3xl mx-auto px-6 py-16 md:py-20 space-y-5">
          <Link href="/" className="inline-flex items-center gap-1.5 text-tft-text-muted hover:text-tft-cyan-bright transition-colors text-sm font-ui">
            <ChevronLeft size={14} />
            Accueil
          </Link>

          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-tft-purple/15 border border-tft-purple/40 flex items-center justify-center">
              <Shield size={20} className="text-tft-purple-bright" />
            </div>
            <div>
              <p className="font-ui text-[10px] tracking-[0.22em] uppercase text-tft-text-muted">tft.money</p>
              <h1 className="font-display font-bold text-3xl md:text-4xl text-tft-text leading-tight">
                Conditions d&apos;Utilisation
              </h1>
            </div>
          </div>

          <p className="text-sm text-tft-text-muted">
            Version en vigueur depuis le 1<sup>er</sup> juin 2026. Dernière modification : 29 mai 2026.
          </p>
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-14 space-y-10">
        {SECTIONS.map((s) => (
          <article key={s.title} className="space-y-3">
            <h2 className="font-display font-semibold text-xl text-tft-purple-bright">{s.title}</h2>
            <div className="text-sm text-tft-text-dim leading-relaxed whitespace-pre-line">{s.body}</div>
          </article>
        ))}

        <div className="rounded-xl border border-tft-border bg-tft-bg-card/60 p-5 text-sm text-tft-text-muted">
          Une question sur ces conditions ? Écris à{' '}
          <a href="mailto:support@tft.money" className="text-tft-cyan-bright hover:underline">
            support@tft.money
          </a>{' '}
          ou ouvre un{' '}
          <Link href="/support" className="text-tft-cyan-bright hover:underline">
            ticket support
          </Link>.
        </div>
      </section>
    </div>
  );
}
