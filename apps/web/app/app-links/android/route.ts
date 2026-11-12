import { androidAssetLinks } from '@/lib/app-links';

export const dynamic = 'force-dynamic';
/** /.well-known/assetlinks.json (see lib/app-links.ts). */
export function GET() {
  const body = androidAssetLinks();
  return body ? Response.json(body, { headers: { 'cache-control': 'public, max-age=3600' } }) : new Response('Not set up', { status: 404 });
}
