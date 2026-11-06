// Markdown to safe HTML, shared by the web app (preview, Word, PDF) and the server (Jack's AI documents sent to a chat).
import type { AiSource } from './phase2';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? esc(u) : '#');

/** Bold, italics, code and links inside a line. Everything is escaped first. */
function inline(s: string, sources?: AiSource[]) {
  let h = esc(s);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>').replace(/(^|\W)_([^_]+)_(?=\W|$)/g, '$1<em>$2</em>');
  h = h.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (_m, t: string, u: string) => `<a href="${safeUrl(u.replace(/&amp;/g, '&'))}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  if (sources?.length) h = h.replace(/\[(\d{1,2})\]/g, (m, n: string) => { const s2 = sources.find((x) => x.n === Number(n)); return s2 ? `<sup><a href="${safeUrl(s2.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s2.title)}">${n}</a></sup>` : m; });
  return h;
}

/**
 * A small Markdown subset to HTML: headings, paragraphs, lists, tables, quotes and rules.
 * Safe to put in the page: all text is escaped and only http(s) links are kept.
 */
export function mdToHtml(md: string, sources?: AiSource[]): string {
  const lines = md.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  const para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map((l) => inline(l, sources)).join('<br>')}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { flush(); i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { flush(); out.push(`<h${h[1]!.length}>${inline(h[2]!, sources)}</h${h[1]!.length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]!)) {
      flush();
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c, sources)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c, sources)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) {
      flush();
      const ordered = /\d/.test(li[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const m = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(lines[i]!);
        if (!m || /\d/.test(m[1]!) !== ordered) break;
        items.push(`<li>${inline(m[2]!, sources)}</li>`); i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>\s?/.test(l)) { flush(); out.push(`<blockquote>${inline(l.replace(/^>\s?/, ''), sources)}</blockquote>`); i++; continue; }
    para.push(l); i++;
  }
  flush();
  return out.join('\n');
}

const DOC_CSS = 'body{font-family:Calibri,Arial,sans-serif;font-size:11pt;line-height:1.5;color:#1f1a16;max-width:720px;margin:24px auto}h1{font-size:22pt;margin:0 0 6pt}h2{font-size:14pt;margin:16pt 0 4pt}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}';
export function docHtml(title: string, md: string) { return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${DOC_CSS}</style></head><body>${mdToHtml(md)}</body></html>`; }

