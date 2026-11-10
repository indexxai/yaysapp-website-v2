import { readFileSync } from 'fs';
import path from 'path';
import { SiteFooter, SiteHeader } from './landing';
import { LineArt } from './ui';

/** The old site's page content, word for word (read at build time from content/), in the site's header and footer. */
export function Legal({ file, children }: { file: string; children?: React.ReactNode }) {
  const html = readFileSync(path.join(process.cwd(), 'content', `${file}.html`), 'utf8');
  return (
    <div className="lp">
      <SiteHeader home={false} />
      <main className="lp-wrap legal">
        <LineArt name="reader" height={260} opacity={0.14} className="lp-art lp-art--r" />
        <div dangerouslySetInnerHTML={{ __html: html }} />
        {children}
      </main>
      <SiteFooter home={false} />
    </div>
  );
}
