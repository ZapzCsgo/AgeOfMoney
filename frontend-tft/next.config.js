const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control',  value: 'on' },
  { key: 'X-Frame-Options',         value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options',  value: 'nosniff' },
  { key: 'Referrer-Policy',         value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy',      value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: " + (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000') + " https://avatars.steamstatic.com https://avatars.akamai.steamstatic.com https://am-a.akamaihd.net https://cdn.discordapp.com",
      "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000') + ' ' + (process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:4000') + ' https://player.twitch.tv https://www.twitch.tv wss://pubsub-edge.twitch.tv https://cloudflareinsights.com',
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
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ['lucide-react', 'date-fns'],
  },
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }];
  },
  images: {
    domains: ['am-a.akamaihd.net', 'avatars.steamstatic.com', 'cdn.discordapp.com'],
  },
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  },
};

module.exports = nextConfig;
