import type { Metadata, Viewport } from 'next';
import '@yays/tokens/tokens.css';
import '@/styles/yays.css';
import '@/styles/app.css';
import { PREFS_BOOT } from '@/lib/prefs';

export const metadata: Metadata = { title: 'YaysApp', description: 'Chat, call and earn with YaysApp.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#141210' }, { color: '#ffffff' }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=Nunito+Sans:opsz,wght@6..12,400;6..12,500;6..12,600;6..12,700&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
