/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@yays/shared', '@yays/tokens'],
  poweredByHeader: false,
  // Links to this app that open the phone app: the files Apple and Google read (lib/app-links.ts).
  async rewrites() {
    return [
      { source: '/.well-known/apple-app-site-association', destination: '/app-links/apple' },
      { source: '/.well-known/assetlinks.json', destination: '/app-links/android' },
    ];
  },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ] }];
  },
};
export default nextConfig;
