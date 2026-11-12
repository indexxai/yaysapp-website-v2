import React, { type ReactNode } from 'react';
import { Linking, View } from 'react-native';
import type { AiSource } from '@yays/shared';
import { font, useTheme } from '../lib/theme';
import { Text } from '../ui/Text';

// The same small Markdown subset as the web (packages/shared/src/markdown.ts): headings, paragraphs, lists, tables,
// quotes, rules; bold, italics, code, links and numbered source marks [1]. Only http(s) links open.
const open = (u: string) => { if (/^https?:\/\//i.test(u)) void Linking.openURL(u).catch(() => undefined); };

function Inline({ text, sources, size }: { text: string; sources?: AiSource[]; size: number }) {
  const t = useTheme();
  const out: ReactNode[] = [];
  // One pass over the line: code, links, bold, italics, source marks.
  const re = /(`[^`]+`)|\[([^\]]+)\]\((https?:[^)\s]+)\)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\b_[^_]+_\b)|\[(\d{1,2})\]/g;
  let at = 0, k = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1]) out.push(<Text key={k++} style={{ fontFamily: 'Menlo', fontSize: size - 1, backgroundColor: t.sunken }}>{m[1].slice(1, -1)}</Text>);
    else if (m[2] && m[3]) { const u = m[3]; out.push(<Text key={k++} accessibilityRole="link" style={{ color: t['ember-ink'], textDecorationLine: 'underline' }} onPress={() => open(u)}>{m[2]}</Text>); }
    else if (m[4]) out.push(<Text key={k++} style={{ fontWeight: '800' }}>{m[4].slice(2, -2)}</Text>);
    else if (m[5]) out.push(<Text key={k++} style={{ fontStyle: 'italic' }}>{m[5].slice(1, -1)}</Text>);
    else if (m[6]) out.push(<Text key={k++} style={{ fontStyle: 'italic' }}>{m[6].slice(1, -1)}</Text>);
    else if (m[7]) {
      const s = sources?.find((x) => x.n === Number(m![7]));
      out.push(s ? <Text key={k++} accessibilityRole="link" accessibilityLabel={`Source ${s.n}: ${s.title}`} onPress={() => open(s.url)} style={{ fontSize: size - 3, fontWeight: '800', color: t['ember-ink'] }}> {s.n}</Text> : m[0]);
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return <>{out}</>;
}

export function Markdown({ md, sources, size = 14 }: { md: string; sources?: AiSource[]; size?: number }) {
  const t = useTheme();
  const lines = md.replace(/\r/g, '').split('\n');
  const blocks: ReactNode[] = [];
  const para: string[] = [];
  const lh = Math.round(size * 1.5);
  const body = { fontSize: size, lineHeight: lh, color: t.ink };
  const flush = () => {
    if (!para.length) return;
    const p = para.splice(0);
    blocks.push(<Text key={blocks.length} style={body}>{p.map((l, i) => <React.Fragment key={i}>{i ? '\n' : ''}<Inline text={l} sources={sources} size={size} /></React.Fragment>)}</Text>);
  };
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    if (!l.trim()) { flush(); i++; continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) {
      flush();
      const lvl = h[1]!.length;
      blocks.push(<Text key={blocks.length} accessibilityRole="header" style={{ fontFamily: font.display, fontWeight: '800', fontSize: size + (lvl === 1 ? 8 : lvl === 2 ? 4 : 2), lineHeight: lh + 6, color: t.ink, marginTop: blocks.length ? 4 : 0 }}><Inline text={h[2]!} sources={sources} size={size} /></Text>);
      i++; continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(l.trim())) { flush(); blocks.push(<View key={blocks.length} style={{ height: 1, backgroundColor: t.line, marginVertical: 4 }} />); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1]!)) {
      flush();
      const cells = (r: string) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(l); i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!)) rows.push(cells(lines[i++]!));
      blocks.push(
        <View key={blocks.length} style={{ borderWidth: 1, borderColor: t.line, borderRadius: 10, overflow: 'hidden' }}>
          {[head, ...rows].map((r, ri) => (
            <View key={ri} style={{ flexDirection: 'row', backgroundColor: ri === 0 ? t.sunken : 'transparent', borderTopWidth: ri ? 1 : 0, borderTopColor: t.line }}>
              {r.map((c, ci) => <Text key={ci} style={{ flex: 1, padding: 6, fontSize: size - 1, fontWeight: ri === 0 ? '700' : '400', color: t.ink }}><Inline text={c} sources={sources} size={size - 1} /></Text>)}
            </View>
          ))}
        </View>,
      );
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
        items.push(m[2]!); i++;
      }
      blocks.push(
        <View key={blocks.length} style={{ gap: 3 }}>
          {items.map((it, n) => <View key={n} style={{ flexDirection: 'row', gap: 8 }}><Text style={[body, { minWidth: 16, color: t['ink-soft'] }]}>{ordered ? `${n + 1}.` : '•'}</Text><Text style={[body, { flex: 1 }]}><Inline text={it} sources={sources} size={size} /></Text></View>)}
        </View>,
      );
      continue;
    }
    if (/^>\s?/.test(l)) { flush(); blocks.push(<View key={blocks.length} style={{ borderLeftWidth: 3, borderLeftColor: t['ember-light'], paddingLeft: 10 }}><Text style={[body, { color: t['ink-soft'] }]}><Inline text={l.replace(/^>\s?/, '')} sources={sources} size={size} /></Text></View>); i++; continue; }
    para.push(l); i++;
  }
  flush();
  return <View style={{ gap: 8 }}>{blocks}</View>;
}
