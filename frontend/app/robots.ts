import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Main rule — allow public pages, block auth/admin
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin',
          '/admin/',
          '/profile',
          '/profile/',
          '/deposit',
          '/withdraw',
          '/affiliate',
          '/_next/',
        ],
      },
      // Explicitly allow search + AI crawlers on all public content
      {
        userAgent: 'Googlebot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'Bingbot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      // OpenAI: GPTBot crawls for training, OAI-SearchBot powers ChatGPT's
      // search/citations, ChatGPT-User fetches a page a user pasted/asked about.
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'OAI-SearchBot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'ChatGPT-User',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      // Anthropic: ClaudeBot is the current general crawler; anthropic-ai and
      // Claude-Web are older identifiers kept for compatibility.
      {
        userAgent: 'ClaudeBot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'anthropic-ai',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'Claude-Web',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'PerplexityBot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'CCBot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'Bytespider',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
    ],
    sitemap: 'https://ageof.money/sitemap.xml',
    host: 'https://ageof.money',
  };
}
