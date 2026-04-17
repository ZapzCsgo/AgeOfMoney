'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { X, Shield } from 'lucide-react';

const SECTIONS = [
  {
    title: 'Collecte des informations',
    content: `AgeOfMoney accorde une grande importance à votre vie privée et s'efforce de ne collecter que les informations nécessaires pour vous offrir une expérience utilisateur optimale. Lors de l'utilisation d'AgeOfMoney, les utilisateurs peuvent fournir des informations permettant de les identifier personnellement, notamment leur nom, leur adresse email et leurs informations de facturation (« Informations Personnelles »). Veuillez noter que nous ne stockons pas les informations de carte bancaire pour des raisons de sécurité.

De plus, lorsqu'un utilisateur visite AgeOfMoney, certaines informations sont automatiquement enregistrées, notamment l'adresse IP et le type de navigateur. Cela nous permet de mieux comprendre l'utilisation de notre site et d'améliorer continuellement nos services.

Pour améliorer votre expérience, AgeOfMoney utilise des cookies — de petits fichiers texte stockés sur votre appareil. Ces cookies permettent aux utilisateurs de rester connectés entre les sessions, améliorant ainsi la convivialité. En utilisant AgeOfMoney, vous consentez à l'utilisation des cookies telle que décrite dans cette politique.`,
  },
  {
    title: 'Utilisation des informations',
    content: `AgeOfMoney utilise vos Informations Personnelles de la manière suivante :

• Fournir et améliorer AgeOfMoney et ses services : vos informations nous permettent de délivrer une expérience agréable et d'améliorer continuellement notre plateforme.

• Gérer votre adhésion et garantir la conformité : les Informations Personnelles servent à gérer votre compte et à vérifier le respect de nos Conditions d'Utilisation.

• Mieux comprendre vos besoins : l'analyse de vos informations nous aide à développer des fonctionnalités adaptées à vos préférences.

• Répondre à vos demandes : vos informations sont utilisées pour traiter vos transactions, répondre à vos questions et vous fournir une assistance.

• Personnaliser votre expérience : vos Informations Personnelles nous permettent d'adapter le contenu et les offres à vos préférences.`,
  },
  {
    title: 'Divulgation à des tiers',
    content: `AgeOfMoney peut faire appel à des sociétés tierces pour faciliter et améliorer nos services. Ces prestataires peuvent avoir accès à certaines Informations Personnelles uniquement dans le cadre de l'exécution de tâches pour le compte d'AgeOfMoney (support technique, analyse de données, traitement des paiements, service client).

L'accès accordé à ces tiers est strictement limité aux tâches qui leur sont confiées. Nous sélectionnons soigneusement nos partenaires qui respectent des normes strictes de protection des données et de sécurité.`,
  },
  {
    title: 'Divulgation légale',
    content: `AgeOfMoney s'engage à respecter la loi et à promouvoir un comportement éthique au sein de sa communauté. Pour garantir le respect des exigences légales, AgeOfMoney peut être tenu de coopérer avec les autorités compétentes. Dans ce cas, nous pourrions devoir divulguer certaines Informations Personnelles afin de prévenir, enquêter ou traiter toute activité illégale ou contraire à nos Conditions d'Utilisation.

AgeOfMoney exercera son jugement pour effectuer de telles divulgations de manière responsable. Toute divulgation ne sera faite que lorsqu'elle sera jugée nécessaire et appropriée.`,
  },
  {
    title: 'Modification et suppression de vos informations',
    content: `Il est de votre responsabilité de vous assurer que les Informations Personnelles que nous détenons restent exactes et à jour. En cas de changement (adresse, coordonnées), nous vous demandons d'en informer AgeOfMoney dans les meilleurs délais.

Si vous souhaitez faire supprimer vos Informations Personnelles de nos registres, vous pouvez en faire la demande en contactant notre équipe support. Suite à votre demande, nous procéderons à la suppression de vos données dans un délai d'un an. Si vous avez des questions sur la mise à jour de vos informations, n'hésitez pas à nous contacter.`,
  },
  {
    title: 'Sécurité',
    content: `La protection de vos Informations Personnelles est une priorité absolue pour AgeOfMoney. Nous nous engageons à mettre en place des mesures raisonnables pour protéger vos données contre tout accès non autorisé et tout contact non sollicité de la part de tiers.

Pour garantir le plus haut niveau de sécurité, nous avons adopté des mesures strictes, notamment l'utilisation de réseaux sécurisés et de technologies de chiffrement avancées pour la transmission des données sensibles. Vos Informations Personnelles sont stockées sur des serveurs sécurisés, accessibles uniquement au personnel autorisé.

Si vous avez des inquiétudes concernant les mesures de sécurité ou si vous suspectez une activité non autorisée, n'hésitez pas à nous contacter.`,
  },
];

export default function PrivacyPage() {
  const [open, setOpen] = useState(true);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: '#07060f' }}>
      {/* Trigger button if modal closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="px-6 py-3 rounded-lg font-bold text-[13px] transition-all hover:opacity-90"
          style={{ background: '#d4a017', color: '#07060f' }}>
          Lire la Politique de Confidentialité
        </button>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl overflow-hidden"
            style={{ background: '#0d0b1a', border: '1px solid #1e1a30' }}>

            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-4 shrink-0" style={{ borderBottom: '1px solid #1e1a30', background: '#09080f' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: '#d4a01720', border: '1px solid #d4a01740' }}>
                <Shield size={15} style={{ color: '#d4a017' }} />
              </div>
              <div className="flex-1">
                <h2 className="text-[15px] font-bold" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
                  Politique de Confidentialité
                </h2>
                <p className="text-[10px]" style={{ color: '#6b6488' }}>AgeOfMoney — Dernière mise à jour : 2026</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="w-7 h-7 rounded-full flex items-center justify-center transition-colors hover:bg-[#1e1a30]">
                <X size={14} style={{ color: '#6b6488' }} />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              <p className="text-[13px] leading-relaxed" style={{ color: '#9990b8' }}>
                Bienvenue sur AgeOfMoney. Nous accordons la plus grande importance à la confidentialité et à la sécurité de vos informations personnelles. Cette Politique de Confidentialité est conçue pour vous aider à comprendre quelles informations nous collectons et comment nous les gérons.
              </p>

              {SECTIONS.map(section => (
                <div key={section.title}>
                  <h3 className="text-[13px] font-bold mb-2.5" style={{ color: '#d4a017' }}>
                    {section.title}
                  </h3>
                  <p className="text-[12px] leading-relaxed whitespace-pre-line" style={{ color: '#9990b8' }}>
                    {section.content}
                  </p>
                </div>
              ))}

              <div className="rounded-xl p-4 mt-2" style={{ background: '#13111f', border: '1px solid #1e1a30' }}>
                <p className="text-[11px] leading-relaxed" style={{ color: '#6b6488' }}>
                  Pour toute question relative à cette politique de confidentialité, contactez-nous à{' '}
                  <a href="mailto:support@ageofmoney.gg" className="hover:opacity-80 transition-opacity" style={{ color: '#d4a017' }}>
                    support@ageofmoney.gg
                  </a>
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 shrink-0 flex justify-end" style={{ borderTop: '1px solid #1e1a30', background: '#09080f' }}>
              <button
                onClick={() => setOpen(false)}
                className="px-5 py-2 rounded-lg text-[12px] font-bold transition-all hover:opacity-90"
                style={{ background: '#d4a017', color: '#07060f' }}>
                J&apos;ai compris
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
