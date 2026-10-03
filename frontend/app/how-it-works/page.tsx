import type { Metadata } from 'next';
import Link from 'next/link';
import { getServerLocale, type ServerLocale } from '@/lib/serverLocale';
import { translations, TKey } from '@/lib/i18nData';

export const dynamic = 'force-dynamic';

const SECTIONS: Array<{ title: TKey; text: TKey }> = [
  { title: 'how_works_s1_title', text: 'how_works_s1_text' },
  { title: 'how_works_s2_title', text: 'how_works_s2_text' },
  { title: 'how_works_s3_title', text: 'how_works_s3_text' },
  { title: 'how_works_s4_title', text: 'how_works_s4_text' },
  { title: 'how_works_s5_title', text: 'how_works_s5_text' },
];

const META = {
  en: {
    title: 'How AoE4 Betting Works | AgeOfMoney',
    description: 'How odds, match formats, coins, cancellations and responsible play work on AgeOfMoney — the Age of Empires esports betting platform.',
  },
  fr: {
    title: 'Comment fonctionnent les paris AoE4 | AgeOfMoney',
    description: 'Comment fonctionnent les cotes, les formats de match, les coins, les annulations et le jeu responsable sur AgeOfMoney.',
  },
  es: {
    title: 'Cómo funcionan las apuestas AoE4 | AgeOfMoney',
    description: 'Cómo funcionan las cuotas, los formatos de partida, los coins, las cancelaciones y el juego responsable en AgeOfMoney.',
  },
} satisfies Record<ServerLocale, { title: string; description: string }>;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  const m = META[locale];
  const url = 'https://ageof.money/how-it-works';
  return {
    title: { absolute: m.title },
    description: m.description,
    alternates: { canonical: url },
    openGraph: { title: m.title, description: m.description, url, type: 'website' },
    twitter: { card: 'summary_large_image', title: m.title, description: m.description },
  };
}

export default async function HowItWorksPage() {
  const locale = await getServerLocale();
  const t = (key: TKey) => (translations[locale] as Record<string, string>)[key] ?? key;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    '@id': 'https://ageof.money/how-it-works#article',
    headline: t('how_works_title'),
    url: 'https://ageof.money/how-it-works',
    publisher: { '@id': 'https://ageof.money/#organization' },
    about: { '@id': 'https://ageof.money/#organization' },
  };

  return (
    <div className="min-h-screen px-4 py-12" style={{ background: '#07060f' }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <div className="max-w-2xl mx-auto">
        <div className="mb-8 text-center">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-4 text-[11px] font-medium uppercase tracking-widest"
            style={{ background: '#ffc54215', border: '1px solid #ffc54230', color: '#ffc542' }}
          >
            AoE4
          </div>
          <h1 className="text-[28px] font-bold mb-2" style={{ color: '#e8e2f5', fontFamily: 'Cinzel, serif' }}>
            {t('how_works_title')}
          </h1>
        </div>

        <div className="space-y-4">
          {SECTIONS.map(({ title, text }) => (
            <div key={title} className="rounded-2xl p-6" style={{ background: '#0d0b1a', border: '1px solid rgba(255,197,66,0.2)' }}>
              <h2 className="text-[15px] font-bold mb-2" style={{ color: '#ffc542', fontFamily: 'Cinzel, serif' }}>
                {t(title)}
              </h2>
              <p className="text-[13px] leading-relaxed" style={{ color: '#9990b8' }}>
                {t(text)}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/matches"
            className="inline-block px-6 py-2.5 rounded-lg text-[13px] font-bold transition-all hover:opacity-90"
            style={{ background: '#ffc542', color: '#07060f' }}
          >
            {t('nav_matches')}
          </Link>
          <Link
            href="/faq"
            className="inline-block px-6 py-2.5 rounded-lg text-[13px] font-bold transition-all hover:opacity-90"
            style={{ background: 'transparent', color: '#ffc542', border: '1px solid rgba(255,197,66,0.4)' }}
          >
            {t('faq_page_title')}
          </Link>
        </div>
      </div>
    </div>
  );
}
