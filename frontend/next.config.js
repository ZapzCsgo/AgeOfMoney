const path = require('path');

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control',  value: 'on' },
  { key: 'X-Frame-Options',         value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',  value: 'nosniff' },
  { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // unsafe-inline/eval needed by Next.js
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com https://aoe4world.com https://liquipedia.net https://cdn.discordapp.com https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
      "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000') + ' ' + (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000') + ' https://player.twitch.tv https://www.twitch.tv wss://pubsub-edge.twitch.tv',
      "frame-src 'self' https://player.twitch.tv https://www.twitch.tv",
      "media-src 'self' blob: https://*.twitch.tv https://*.jtvnw.net",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self' https://steamcommunity.com",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  compress: true,
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    externalDir: true,
    // Tree-shake imports from these libraries so we only ship what's used
    optimizePackageImports: ['lucide-react', 'date-fns', '@radix-ui/react-avatar', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu', '@radix-ui/react-tabs'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  webpack: (config) => {
    config.resolve.modules = [
      path.resolve(__dirname, 'node_modules'),
      path.resolve(__dirname, '../node_modules'),
      'node_modules',
    ];
    return config;
  },
  images: {
    domains: [
      'aoe4world.com',
      'liquipedia.net',
      'lh3.googleusercontent.com',
      'cdn.discordapp.com',
      'avatars.githubusercontent.com',
      'avatars.steamstatic.com',
      'avatars.akamai.steamstatic.com',
    ],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
};

module.exports = nextConfig;
