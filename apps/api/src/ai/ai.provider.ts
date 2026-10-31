import type { AiSource } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Config } from '../config';
import type { Logger } from '../common/logger';

export interface AiTurn { role: 'user' | 'assistant'; text: string }
export interface AiResult { text: string; sources: AiSource[] }
export interface AiProvider {
  readonly name: 'dev' | 'anthropic';
  complete(o: { system: string; turns: AiTurn[]; search?: boolean; maxTokens?: number }): Promise<AiResult>;
}

const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/** Claude, through the Anthropic Messages API. Web search uses Anthropic's own search tool. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  constructor(private readonly c: Config, private readonly log: Logger, private readonly f: typeof fetch = fetch) {}

  async complete(o: { system: string; turns: AiTurn[]; search?: boolean; maxTokens?: number }): Promise<AiResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    let res: Response;
    try {
      res = await this.f('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-api-key': this.c.ANTHROPIC_API_KEY!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: this.c.AI_MODEL, max_tokens: o.maxTokens ?? 1500, system: o.system,
          messages: o.turns.map((t) => ({ role: t.role, content: t.text })),
          ...(o.search ? { tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }] } : {}),
        }),
      });
    } catch {
      throw AppError.conflict('Jack’s AI didn’t answer in time. Try again.');
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      this.log.warn({ status: res.status, body: (await res.text().catch(() => '')).slice(0, 300) }, 'anthropic request failed');
      throw AppError.conflict(res.status === 429 ? 'Jack’s AI is busy right now. Try again in a minute.' : 'Jack’s AI couldn’t answer just now. Try again.');
    }
    const body = await res.json() as { content: Array<{ type: string; text?: string; citations?: Array<{ url?: string; title?: string; cited_text?: string }> }> };
    const sources: AiSource[] = [];
    const num = (url: string, title: string, quote: string) => {
      let s = sources.find((x) => x.url === url);
      if (!s) { s = { n: sources.length + 1, url, title: title || domainOf(url), domain: domainOf(url), quote: quote.slice(0, 200) }; sources.push(s); }
      return s.n;
    };
    let text = '';
    for (const b of body.content) {
      if (b.type !== 'text' || !b.text) continue;
      text += b.text;
      const ns = [...new Set((b.citations ?? []).filter((c) => c.url).map((c) => num(c.url!, c.title ?? '', c.cited_text ?? '')))];
      if (ns.length) text += ns.map((n) => `[${n}]`).join('');
    }
    return { text: text.trim(), sources };
  }
}

/**
 * Development and tests: answers without calling any model, so the app works offline. It says so in every
 * answer. Refused in production.
 */
export class DevProvider implements AiProvider {
  readonly name = 'dev' as const;
  async complete(o: { system: string; turns: AiTurn[]; search?: boolean }): Promise<AiResult> {
    const last = o.turns[o.turns.length - 1]?.text ?? '';
    const ask = last.split('\n').filter(Boolean).pop()?.slice(0, 160) ?? '';
    if (o.system.includes('---DOCUMENT---')) {
      const title = ask.replace(/^(write|make|create|draft)\s+(me\s+)?(a|an)\s+/i, '').replace(/[.?!].*$/, '').slice(0, 60) || 'Document';
      const t = title.charAt(0).toUpperCase() + title.slice(1);
      return { text: `Done. It’s open on the right.\n---DOCUMENT---\n# ${t}\n\n_Demo mode: Jack’s AI isn’t connected to a model yet, so this is a sample layout._\n\n## Summary\n\n${ask}\n\n## Next step\n\nAdd the details, then download it as Word or PDF.`, sources: [] };
    }
    if (o.system.includes('SUMMARY')) {
      const lines = last.split('\n').filter((l) => l.includes(':')).slice(-3).map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
      return { text: `Demo summary (no AI model connected). Latest messages: ${lines.join(' · ') || 'nothing yet'}.`, sources: [] };
    }
    return { text: `Jack’s AI is in demo mode, so this is a sample answer.${o.search ? ' Web search needs a real model to be connected.' : ''} You asked: “${ask}”`, sources: [] };
  }
}

export function createAiProvider(c: Config, log: Logger): AiProvider {
  return c.AI_DRIVER === 'anthropic' ? new AnthropicProvider(c, log) : new DevProvider();
}
export const AI_PROVIDER = Symbol('AI_PROVIDER');
