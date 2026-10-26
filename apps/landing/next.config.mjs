/** Static site: `next build` writes plain HTML to out/, ready for any static host or CDN. */
const nextConfig = { output: 'export', trailingSlash: false, images: { unoptimized: true }, transpilePackages: ['@yays/tokens'], poweredByHeader: false };
export default nextConfig;
