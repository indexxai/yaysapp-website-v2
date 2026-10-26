import { readFileSync } from 'fs';
import path from 'path';

/** The old site's page content, word for word. Read at build time from content/. */
export function Legal({ file, children }: { file: string; children?: React.ReactNode }) {
  const html = readFileSync(path.join(process.cwd(), 'content', `${file}.html`), 'utf8');
  return <main className="wrap legal"><div dangerouslySetInnerHTML={{ __html: html }} />{children}</main>;
}
