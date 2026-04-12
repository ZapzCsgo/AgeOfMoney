'use client';

import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

const SECTIONS = [
  {
    title: '1. Acceptation des Conditions',
    content: `Les presentes Conditions Generales d'Utilisation ("Conditions", "Accord") regissent l'utilisation de tous les Services disponibles sur AgeOfMoney, accessible a l'adresse ageof.money ("le Site", "la Plateforme"). En accedant ou en utilisant les Services, l'Utilisateur accepte d'etre lie par cet Accord tel qu'il est redige ici. Si l'Utilisateur n'accepte pas ces conditions, il ne peut pas acceder aux Services.

En accedant ou en utilisant les Services, l'Utilisateur certifie qu'il a au moins 18 ans. Si l'Utilisateur n'a pas 18 ans ou plus, il ne peut pas acceder aux Services.

Un Utilisateur ne peut pas utiliser les Services s'il reside dans une juridiction ou il n'est pas legal pour lui d'utiliser les Services.`,
  },
  {
    title: '2. Monnaie Virtuelle et Credits',
    content: `AgeOfMoney fonctionne strictement comme une plateforme de divertissement social. Les Utilisateurs reconnaissent et acceptent que :

- Tous les credits en jeu (coins, symbolises par le signe ⚜) et autres elements virtuels n'ont aucune valeur monetaire reelle et ne peuvent pas etre echanges contre de l'argent reel ou toute autre forme de monnaie du monde reel.

- Les coins sont uniquement destines a des fins de divertissement au sein d'AgeOfMoney et ne peuvent pas etre transferes ou echanges en dehors de la plateforme.

- Partage de compte : Les Utilisateurs sont strictement interdits de partager leur compte AgeOfMoney avec toute autre personne ou entite. Chaque compte est a usage individuel uniquement, et le partage de compte est considere comme une violation des presentes Conditions.

- Transfert de compte : Le transfert ou la tentative de transfert de propriete ou de controle d'un compte AgeOfMoney a une autre personne ou entite est strictement interdit.

- Resiliation de compte : La participation a une conduite interdite peut entrainer la suppression d'un compte.

- Toute conduite interdite, y compris mais sans s'y limiter : la falsification d'informations pour ouvrir un compte, la fraude financiere, la violation de nos conditions d'utilisation ou regles de jeu, la menace ou le harcelement d'autres joueurs ou du personnel, l'interference avec le fonctionnement du service, l'utilisation de scripts non autorises ou de moyens automatises, entrainera la resiliation immediate du compte de l'Utilisateur.

- En cas de conduite interdite, AgeOfMoney se reserve le droit de suspendre ou de resilier l'acces de l'Utilisateur a nos Services immediatement, sans preavis ni responsabilite.

- AgeOfMoney se reserve le droit de demander des informations personnelles a l'Utilisateur en cas de suspicion de conduite interdite.

- Si le compte d'un Utilisateur est resilie, il peut perdre l'acces a son compte, y compris tous les elements, recompenses, nom d'utilisateur et historique de jeu associes.`,
  },
  {
    title: '3. Achats et Depots',
    content: `AgeOfMoney peut offrir la possibilite d'acheter des coins ou d'autres elements virtuels. Il est important de noter que :

- Ces achats sont strictement a des fins de divertissement virtuel et ne constituent pas des jeux d'argent ou des paris en argent reel.

- Les Utilisateurs comprennent et acceptent que tous les achats sont definitifs et ne peuvent etre rembourses ou echanges contre de l'argent.

- Les conditions reaffirment explicitement que ces elements virtuels n'ont aucune valeur dans le monde reel.

Depot en cryptomonnaie : Nous offrons la possibilite de financer votre compte avec diverses cryptomonnaies. Veuillez noter que tous les depots et retraits en cryptomonnaie sont consideres comme definitifs, et aucun remboursement ne sera effectue pour les depots envoyes a des adresses publiques incorrectes.

Non-responsabilite pour les accidents de mainchain : AgeOfMoney ne sera pas tenu responsable de tout transfert accidentel de tokens sur une mainchain. Il est de la responsabilite de l'Utilisateur de s'assurer qu'il envoie la bonne cryptomonnaie sur le bon reseau.

Taux de change :
- Depot : 1 USD = 1.69 coins ⚜
- Retrait : 1.69 coins ⚜ = 0.99 USD`,
  },
  {
    title: '4. Programme d\'Affiliation',
    content: `AgeOfMoney propose un programme d'affiliation, et tout retrait associe au programme est base uniquement sur les commissions de parrainage. Les Utilisateurs doivent etre conscients que :

- La fonction "retrait" dans le programme d'affiliation se refere uniquement au transfert de gains provenant de parrainages et n'est pas liee au retrait de credits en jeu ou de gains.

- AgeOfMoney se reserve le droit de modifier ou de desactiver la participation au programme d'affiliation a sa seule discretion, en particulier en cas d'abus ou de violation de nos conditions.

- En cas extreme d'abus ou de violation de nos conditions, AgeOfMoney se reserve le droit de confisquer les gains d'affiliation.`,
  },
  {
    title: '5. Jeux et Fonctionnalites',
    content: `Droit de refuser l'acces : AgeOfMoney se reserve le droit de refuser l'acces d'un Utilisateur a tout jeu a tout moment, sans preavis.

Invalidation des jeux : Tout jeu peut etre invalide a tout moment pour prevenir une activite deloyale ou illegale, entre autres raisons.

Paris sur les matchs :
- Les cotes sont calculees par notre systeme en fonction des donnees historiques des joueurs professionnels.
- Les paris sont fermes des que le match commence.
- En cas de forfait (walkover), tous les paris sont rembourses.
- En cas d'egalite (formats BO pairs), les paris sur l'egalite gagnent et les paris sur les joueurs perdent.

Roulette :
- La roulette utilise un systeme "Provably Fair" verifiable.
- Les Utilisateurs sont responsables de toutes les actions prises avec l'option de jeu automatise.
- AgeOfMoney ne sera pas responsable des resultats de jeu resultant de son utilisation. Aucun remboursement ne sera accorde pour un jeu automatise accidentel.`,
  },
  {
    title: '6. Recompenses et Gains',
    content: `Recompenses retardees ou annulees : Les recompenses peuvent etre sujettes a un retard ou a une annulation si un Utilisateur viole cet Accord, meme apres que les recompenses aient ete initialement distribuees.

Resolution des litiges : Dans tout litige decoulant de l'utilisation de nos Services, AgeOfMoney agit comme autorite finale, et tous les joueurs sont tenus de cooperer avec les resultats determines par AgeOfMoney.

Droit d'annuler la participation : AgeOfMoney se reserve le droit d'annuler la capacite d'un Utilisateur a participer a un jeu ou a utiliser nos Services entierement si nous determinons que les actions de l'Utilisateur sont inappropriees, deloyales, frauduleuses ou prejudiciables a d'autres Utilisateurs.`,
  },
  {
    title: '7. Jeu Responsable',
    content: `AgeOfMoney reconnait l'importance du jeu responsable et propose des outils pour promouvoir un environnement de jeu sur, y compris :

- Des options d'auto-exclusion, permettant aux Utilisateurs de prendre des pauses si necessaire.

- Une politique stricte de restriction d'age garantissant qu'aucun Utilisateur de moins de 18 ans ne peut participer.

- Des mesures pour prevenir le partage de compte non autorise ou les abus.

AgeOfMoney prend le jeu responsable au serieux et encourage les Utilisateurs a utiliser la fonctionnalite d'auto-exclusion s'ils estiment que c'est necessaire.`,
  },
  {
    title: '8. Absence de Garanties',
    content: `Utilisation a vos propres risques : Votre utilisation du site, de son contenu et de tout service ou element obtenu via le site est entierement a vos propres risques.

Base "tel quel" et "selon disponibilite" : Le site, son contenu et tout service ou element obtenu via le site sont fournis sur une base "tel quel" et "selon disponibilite", sans aucune garantie d'aucune sorte.

AgeOfMoney ne garantit pas que le site sera precis, fiable, exempt d'erreurs ou ininterrompu. Nous ne garantissons pas que les defauts seront corriges ou que le site ou le serveur qui le rend disponible sont exempts de virus ou d'autres composants nuisibles.

AgeOfMoney decline par la presente toutes les garanties de quelque nature que ce soit, qu'elles soient expresses ou implicites, y compris mais sans s'y limiter, toute garantie de qualite marchande, de non-contrefacon et d'adequation a un usage particulier.`,
  },
  {
    title: '9. Non-affiliation',
    content: `AgeOfMoney n'est pas affilie, approuve ou associe a Xbox Game Studios, Microsoft Corporation, Steam, Valve Corporation, ou toute autre marque deposee appartenant a ces entites.

AgeOfMoney est une plateforme en ligne independante et fonctionne separement de ces entites. Bien que nous puissions offrir certains services de divertissement lies aux jeux de ces editeurs, il est essentiel de comprendre que notre site est entierement separe de ces plateformes.`,
  },
  {
    title: '10. Erreurs / Bugs',
    content: `Non-droit aux recompenses ou remboursements : En cas d'erreurs d'interface ou de manipulation, les Utilisateurs n'ont pas le droit de reclamer des recompenses de jeu ou des remboursements bases sur ces occurrences.

AgeOfMoney se reserve le droit de corriger toute erreur affectant les soldes, les paris ou les resultats de jeu a tout moment.`,
  },
  {
    title: '11. Limitation de Responsabilite',
    content: `Utilisation a votre seule discretion et risque : Les Utilisateurs reconnaissent et acceptent que l'utilisation d'AgeOfMoney est uniquement a leur propre discretion et risque.

Aucune responsabilite pour les dommages indirects : Les Utilisateurs comprennent et acceptent qu'AgeOfMoney ne sera pas responsable de tout dommage indirect, accessoire, special, consecutif ou exemplaire.

Responsabilite pour les fonds perdus, comptes pirates ou retraits accidentels : AgeOfMoney n'est pas responsable des fonds perdus, des comptes pirates ou des retraits accidentels subis par les Utilisateurs. Il est de la responsabilite de l'Utilisateur de securiser son compte et de prendre les precautions necessaires.`,
  },
  {
    title: '12. Maintenance du Systeme',
    content: `AgeOfMoney effectue periodiquement des travaux de maintenance sur ses systemes pour assurer la securite et l'integrite de la plateforme. Pendant ces periodes de maintenance, certaines fonctionnalites ou toutes les fonctionnalites d'AgeOfMoney peuvent etre temporairement indisponibles.

AgeOfMoney se reserve le droit de modifier ou de cesser tout aspect du site, y compris la disponibilite des fonctionnalites, du contenu et des concours, a tout moment et sans preavis.`,
  },
  {
    title: '13. Propriete Intellectuelle',
    content: `Tout le contenu sur AgeOfMoney, y compris mais sans s'y limiter les images, logiciels, noms, logos, graphiques et elements virtuels, est soit detenu soit sous licence par AgeOfMoney. Ce contenu est protege par le droit d'auteur et d'autres lois sur la propriete intellectuelle.

Les Utilisateurs sont strictement interdits d'acceder ou d'utiliser toute partie ou tout materiel disponible sur AgeOfMoney a des fins commerciales.`,
  },
  {
    title: '14. Code de Conduite',
    content: `Les Utilisateurs s'engagent a ne pas utiliser AgeOfMoney a des fins illicites. Les actions suivantes sont strictement interdites :

- Planifier ou participer a des activites illegales.
- Publier du contenu diffamatoire, abusif, obscene ou violant la loi.
- Menacer, harceler ou intimider d'autres Utilisateurs.
- Utiliser des moyens automatises, y compris des bots ou des scrapers.
- Abuser du systeme de signalement ou creer de faux rapports.
- Utiliser une fausse identite ou tenter d'usurper l'identite d'une autre personne.
- Creer plus d'un (1) compte par Utilisateur.
- Vendre ou transferer son compte a un tiers.

La violation de l'une de ces regles peut entrainer la suspension ou la resiliation du compte de l'Utilisateur et peut egalement entrainer des poursuites judiciaires si necessaire.`,
  },
  {
    title: '15. Confidentialite et Donnees Personnelles',
    content: `En utilisant AgeOfMoney, les Utilisateurs acceptent la collecte de leurs informations personnelles dans le but de fournir une bonne experience utilisateur et d'assurer un environnement sur pour tous les Utilisateurs.

AgeOfMoney peut, de temps a autre, demander des informations supplementaires aux Utilisateurs pour assurer la conformite avec cet accord et les reglementations applicables.

AgeOfMoney ne vendra ni ne partagera jamais vos informations personnelles a des fins de marketing ou de profit.

Les Utilisateurs sont responsables d'informer AgeOfMoney rapidement en cas de modification de leurs informations personnelles.

Pour plus de details, veuillez consulter notre Politique de Confidentialite.`,
  },
  {
    title: '16. Force Majeure',
    content: `Nous reconnaissons que certains evenements ou circonstances imprevus, tels que des catastrophes naturelles, guerres, incendies, emeutes, tremblements de terre, terrorisme ou actions des autorites gouvernementales en dehors de notre controle, peuvent affecter notre capacite a nous conformer aux Conditions. Dans de tels cas, nous ne serons pas consideres comme en violation de ces Conditions.`,
  },
  {
    title: '17. Modifications',
    content: `AgeOfMoney se reserve le droit de modifier ou de mettre a jour ces Conditions a tout moment, a sa seule discretion. Les modifications apportees a cet Accord seront en vigueur a compter de la date de publication.

Il est de la responsabilite de l'Utilisateur de consulter regulierement ces Conditions pour prendre connaissance de toute modification.

L'utilisation continue des Services apres la publication de modifications constitue l'acceptation de ces modifications.`,
  },
  {
    title: '18. Dispositions Diverses',
    content: `AgeOfMoney peut publier des politiques supplementaires liees a des services specifiques offerts sur la plateforme. Les Utilisateurs doivent etre conscients que cet accord s'etend a toute autre politique publiee relative a AgeOfMoney et a ses services.

Liens tiers : AgeOfMoney n'assume aucune responsabilite pour le contenu, l'exactitude, la legalite ou la disponibilite des informations, produits ou services offerts sur des sites web tiers.

Pour toute question ou preoccupation concernant ces Conditions, les Utilisateurs sont encourages a contacter notre equipe de support.`,
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen" style={{ background: '#07060f' }}>
      <div className="max-w-3xl mx-auto px-6 py-12">
        {/* Header */}
        <Link href="/" className="inline-flex items-center gap-1 text-[#6b6488] hover:text-[#d4a017] text-sm mb-8 transition-colors">
          <ChevronLeft size={14} /> Retour
        </Link>

        <h1 className="font-cinzel font-black text-3xl tracking-[0.1em] text-[#f5c842] mb-2">
          CONDITIONS D'UTILISATION
        </h1>
        <p className="text-[#6b6488] text-sm mb-2">
          AgeOfMoney &mdash; ageof.money
        </p>
        <p className="text-[#4a4570] text-xs mb-10">
          Derniere mise a jour : 12 avril 2026
        </p>

        <div className="h-px mb-10" style={{ background: 'linear-gradient(90deg, transparent, #d4a017 40%, #f5c842 50%, #d4a017 60%, transparent)' }} />

        {/* Sections */}
        <div className="space-y-10">
          {SECTIONS.map((s, i) => (
            <section key={i}>
              <h2 className="font-cinzel font-bold text-base text-[#d4a017] mb-3 tracking-wide">
                {s.title}
              </h2>
              <div className="text-[13px] leading-relaxed text-[#c8c0e0] whitespace-pre-line">
                {s.content}
              </div>
            </section>
          ))}
        </div>

        <div className="h-px mt-12 mb-6" style={{ background: 'linear-gradient(90deg, transparent, #1e1a30, transparent)' }} />
        <p className="text-[11px] text-[#3d3860] text-center">
          &copy; 2026 AgeOfMoney. Tous droits reserves.
        </p>
      </div>
    </div>
  );
}
