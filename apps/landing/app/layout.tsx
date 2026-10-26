import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import '@yays/tokens/tokens.css';
import './site.css';
import { PLAY_URL } from '@/lib/links';

export const metadata: Metadata = {
  metadataBase: new URL('https://yays.app'),
  title: { default: 'YaysApp — Chat. Earn. Together.', template: '%s — YaysApp' },
  description: 'YaysApp is a messaging app with communities, calls and rewards. Free on Android, coming soon to iPhone.',
  openGraph: { title: 'YaysApp — Chat. Earn. Together.', description: 'Messages, calls and communities, with rewards for the things you already do.', images: ['/img/yaysapp-wordmark.png'] },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#e5852b' };


export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&family=Nunito+Sans:opsz,wght@6..12,400;6..12,600;6..12,700&display=swap" />
      </head>
      <body>
        <header className="nav">
          <div className="wrap nav-in">
            <Link href="/" className="brand" aria-label="YaysApp home"><img src="/img/yaysapp-mark.png" alt="" width={36} height={36} /><span>YaysApp</span></Link>
            <nav aria-label="Main" className="nav-links">
              <Link href="/#features">Features</Link><Link href="/#earn">Earn</Link><Link href="/#ecosystem">Ecosystem</Link><Link href="/support">Support</Link>
            </nav>
            <a className="store store-sm" href={PLAY_URL}>Get the app</a>
          </div>
        </header>
        {children}
        <footer className="foot">
          <div className="wrap foot-in">
            <div className="brand"><img src="/img/yaysapp-mark.png" alt="" width={28} height={28} /><span>YaysApp</span></div>
            <nav aria-label="Footer" className="foot-links">
              <Link href="/privacy">Privacy</Link><Link href="/delete-account">Delete account</Link><Link href="/terms">Terms</Link><Link href="/support">Support</Link><a href={PLAY_URL}>Download</a>
            </nav>
            <p className="fine">YaysApp is part of the Indexx ecosystem. IndexxPoints are in-app reward points, not currency, and carry no cash value.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
