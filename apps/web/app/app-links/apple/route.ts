import { appleSiteAssociation } from '@/lib/app-links';

export const dynamic = 'force-dynamic';
/** /.well-known/apple-app-site-association (see lib/app-links.ts). */
export function GET() {
  const body = appleSiteAssociation();
  return body ? Response.json(body, { headers: { 'cache-control': 'public, max-age=3600' } }) : new Response('Not set up', { status: 404 });
}
