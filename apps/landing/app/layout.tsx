import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/outfit';
import '@fontsource-variable/nunito-sans/opsz.css';
import '@/styles/tokens.css';
import '@/styles/yays.css';
import '@/styles/app.css';
import '@/styles/phase2.css';
import '@/styles/circles.css';
import '@/styles/site.css';
import { THEME_BOOT } from '@/lib/theme';

export const metadata: Metadata = {
  metadataBase: new URL('https://yaysapp.com'),
  title: { default: 'YaysApp: the chat app that rewards you for showing up', template: '%s — YaysApp' },
  description: 'Message friends, call, join communities and earn INEX every day. On your phone and in your browser.',
  openGraph: { title: 'YaysApp', description: 'Message friends, join communities and earn INEX every day.', images: ['/brand/wordmark.png'] },
  icons: { icon: '/favicon.png', apple: '/apple-touch-icon.png' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#e8762c' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} /></head>
      <body>{children}</body>
    </html>
  );
}
