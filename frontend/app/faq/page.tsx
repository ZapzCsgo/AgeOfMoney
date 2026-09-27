import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { translations, TKey } from '@/lib/i18nData';

export const dynamic = 'force-dynamic';

const FAQ_KEYS: Array<{ q: TKey; a: TKey }> = [
  { q: 'faq_q1', a: 'faq_a1' },
  { q: 'faq_q2', a: 'faq_a2' },
  { q: 'faq_q3', a: 'faq_a3' },
  { q: 'faq_q4', a: 'faq_a4' },
  { q: 'faq_q5', a: 'faq_a5' },
];

const META = {
  en: {
    title: 'FAQ — Age of Empires Betting | AgeOfMoney',
    description: 'Frequently asked questions about AgeOfMoney: what it is, which Age of Empires games you can bet on, how coins work, deposits, withdrawals and minimums.',
  },
  fr: {
    title: 'FAQ — Paris Age of Empires | AgeOfMoney',
    description: 'Questions fréquentes sur AgeOfMoney : ce que c\'est, sur quels jeux Age of Empires parier, le fonctionnement des coins, dépôts, retraits et minimums.',
  },
  es: {
    title: 'FAQ — Apuestas Age of Empires | AgeOfMoney',
    description: 'Preguntas frecuentes sobre AgeOfMoney: qué es, en qué juegos de Age of Empires puedes apostar, cómo funcionan los coins, depósitos, retiros y mínimos.',
  },
} satisfies Record<ServerLocale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const m = META[locale];
  const url = 'https://ageof.money/faq';
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: url },
    openGraph: { title: m.title, description: m.description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title: m.title, description: m.description },
  };
}

export default async function FaqPage() {
  const locale = await getServerLocale();
  const t = (key: TKey) => (translations[locale] as Record<string, string>)[key] ?? key;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': 'https://ageof.money/faq#faq',
    mainEntity: FAQ_KEYS.map(({ q, a }) => ({
      '@type': 'Question',
      name: t(q),
      acceptedAnswer: { '@type': 'Answer', text: t(a) },
    })),
  };

  return (
    <div className="min-h-screen px-4 py-12" style={{ background: '#07060f' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[11px] font-medium uppercase tracking-widest"
            style={{ background: '#ffc54215', border: '1px solid #ffc54230', color: '#ffc542' }}
          >
            FAQ
          </div>
          <h1 className="text-[28px] font-bold mb-2" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
            {t('faq_page_title')}
          </h1>
        </div>

        {/* About section */}
        <div className="rounded-2xl p-6 mb-6" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
          <h2 className="text-[15px] font-bold mb-2" style={{ color: '#ffc542', fontFamily: 'Cinzel, serif' }}>
            {t('faq_about_title')}
          </h2>
          <p className="text-[13px] leading-relaxed" style={{ color: '#9990b8' }}>
            {t('faq_about_text')}
          </p>
        </div>

        {/* Q&A list */}
        <div className="space-y-4">
          {FAQ_KEYS.map(({ q, a }) => (
            <div key={q} className="rounded-2xl p-6" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
              <h3 className="text-[14px] font-bold mb-2" style={{ color: '#e8e2f5' }}>
                {t(q)}
              </h3>
              <p className="text-[13px] leading-relaxed" style={{ color: '#9990b8' }}>
                {t(a)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 text-center">
          <Link
            href="/support"
            className="inline-block px-6 py-2.5 rounded-lg text-[13px] font-bold transition-all hover:opacity-90"
            style={{ background: '#ffc542', color: '#07060f' }}
          >
            {t('footer_support')}
          </Link>
        </div>
      </div>
    </div>
  );
}
