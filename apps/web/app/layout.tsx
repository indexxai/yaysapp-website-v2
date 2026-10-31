import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/outfit';
import '@fontsource-variable/nunito-sans/opsz.css';
import '@yays/tokens/tokens.css';
import '@/styles/yays.css';
import '@/styles/app.css';
import '@/styles/phase2.css';
import { PREFS_BOOT } from '@/lib/prefs';
import { Live } from '@/components/live';

export const metadata: Metadata = { title: 'YaysApp', description: 'Chat, call and earn with YaysApp.', icons: { icon: '/favicon.png', apple: '/apple-touch-icon.png' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#141210' }, { color: '#ffffff' }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: PREFS_BOOT }} />
      </head>
      <body><Live>{children}</Live></body>
    </html>
  );
}
