import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AgeOfMoney',
    short_name: 'AgeOfMoney',
    description:
      'Paris esport Age of Empires — matchs pro, roulette, tournois cash',
    start_url: '/',
    display: 'standalone',
    background_color: '#07060f',
    theme_color: '#d4a017',
    orientation: 'portrait-primary',
    categories: ['games', 'entertainment', 'sports'],
    lang: 'fr-FR',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
