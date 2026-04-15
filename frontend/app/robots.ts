import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
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
    ],
    sitemap: 'https://ageof.money/sitemap.xml',
    host: 'https://ageof.money',
  };
}
