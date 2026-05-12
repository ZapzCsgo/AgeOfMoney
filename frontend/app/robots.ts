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
      // Explicitly allow AI crawlers on all public content
      {
        userAgent: 'GPTBot',
        allow: '/',
        disallow: ['/api/', '/admin', '/profile', '/deposit', '/withdraw', '/affiliate'],
      },
      {
        userAgent: 'PerplexityBot',
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
