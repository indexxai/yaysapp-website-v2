import type { AiSource } from '@yays/shared';
import { AppError } from '../common/app-error';
import type { Config } from '../config';
import type { Logger } from '../common/logger';

export interface AiTurn { role: 'user' | 'assistant'; text: string }
export interface AiResult { text: string; sources: AiSource[] }
export interface AiProvider {
  readonly name: 'dev' | 'anthropic' | 'openrouter' | 'openai';
  /** The model answering, for the info screen and logs. */
  readonly model: string;
  /** Whether "search the web" really searches. */
  readonly canSearch: boolean;
  complete(o: { system: string; turns: AiTurn[]; search?: boolean; maxTokens?: number }): Promise<AiResult>;
}

const domainOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/** Claude, through the Anthropic Messages API. Web search uses Anthropic's own search tool. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  readonly canSearch = true;
  get model() { return this.c.AI_MODEL || 'claude-sonnet-5-5'; }
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
          model: this.model, max_tokens: o.maxTokens ?? 1500, system: o.system,
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
 * Any OpenAI-style chat API: OpenRouter (one key, many models) or OpenAI itself.
 * Web answers: OpenRouter's web plugin, or OpenAI's search model; both mark their sources the same way.
 */
export class OpenAiCompatProvider implements AiProvider {
  readonly canSearch = true;
  constructor(readonly name: 'openrouter' | 'openai', private readonly o: { baseUrl: string; key: string; model: string; webUrl: string }, private readonly log: Logger, private readonly f: typeof fetch = fetch) {}
  get model() { return this.o.model; }

  async complete(q: { system: string; turns: AiTurn[]; search?: boolean; maxTokens?: number }): Promise<AiResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90_000);
    const openai = this.name === 'openai';
    // OpenAI searches with its own search model; OpenRouter adds a web plugin to whichever model is set.
    const model = q.search && openai ? 'gpt-4o-mini-search-preview' : this.o.model;
    const body: Record<string, unknown> = {
      model, max_tokens: q.maxTokens ?? 1500,
      messages: [{ role: 'system', content: q.system }, ...q.turns.map((t) => ({ role: t.role, content: t.text }))],
      ...(q.search ? (openai ? { web_search_options: {} } : { plugins: [{ id: 'web', max_results: 5 }] }) : {}),
    };
    let res: Response;
    try {
      res = await this.f(`${this.o.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.o.key}`, ...(openai ? {} : { 'HTTP-Referer': this.o.webUrl, 'X-Title': 'YaysApp' }) },
        body: JSON.stringify(body),
      });
    } catch {
      throw AppError.conflict('Jack’s AI didn’t answer in time. Try again.');
    } finally { clearTimeout(timer); }
    if (!res.ok) {
      const text = (await res.text().catch(() => '')).slice(0, 300);
      this.log.warn({ provider: this.name, model, status: res.status, body: text }, 'ai request failed');
      if (res.status === 429) throw AppError.conflict('Jack’s AI is busy right now. Try again in a minute.');
      if (res.status === 401 || res.status === 403) throw AppError.conflict('Jack’s AI isn’t set up correctly. The team has been told.');
      if (res.status === 402) throw AppError.conflict('Jack’s AI is paused for now. Try again later.');
      throw AppError.conflict('Jack’s AI couldn’t answer just now. Try again.');
    }
    const j = await res.json() as { choices?: Array<{ finish_reason?: string; message?: { content?: string | null; refusal?: string | null; annotations?: Array<{ type: string; url_citation?: { url: string; title?: string; content?: string } }> } }> };
    const ch = j.choices?.[0];
    const msg = ch?.message;
    if (ch?.finish_reason === 'content_filter' || (!msg?.content && msg?.refusal)) return { text: msg?.refusal || 'I can’t help with that one.', sources: [] };
    let text = (msg?.content ?? '').trim();
    if (!text) throw AppError.conflict('Jack’s AI couldn’t answer just now. Try again.');
    const sources: AiSource[] = [];
    for (const a of msg?.annotations ?? []) {
      const u = a.type === 'url_citation' ? a.url_citation : undefined;
      if (!u?.url || sources.some((x) => x.url === u.url)) continue;
      sources.push({ n: sources.length + 1, url: u.url, title: u.title || domainOf(u.url), domain: domainOf(u.url), quote: (u.content ?? '').slice(0, 200) });
    }
    // Models write sources as [domain](url) links; number the ones we list so the app can show them as [1], [2].
    if (sources.length) for (const src of sources) text = text.split(`(${src.url})`).join(`[${src.n}]`).replace(new RegExp(`\\[([^\\]]+)\\]\\[${src.n}\\]`, 'g'), `$1 [${src.n}]`);
    return { text, sources };
  }
}

/**
 * Development and tests: answers without calling any model, so the app works offline. It says so in every
 * answer. Refused in production.
 */
export class DevProvider implements AiProvider {
  readonly name = 'dev' as const;
  readonly model = 'demo';
  readonly canSearch = false;
  async complete(o: { system: string; turns: AiTurn[]; search?: boolean }): Promise<AiResult> {
    const last = o.turns[o.turns.length - 1]?.text ?? '';
    const ask = last.split('\n').filter(Boolean).pop()?.slice(0, 160) ?? '';
    if (o.system.includes('---DOCUMENT---')) {
      const title = ask.replace(/^(write|make|create|draft)\s+(me\s+)?(a|an)\s+/i, '').replace(/[.?!].*$/, '').slice(0, 60) || 'Document';
      const t = title.charAt(0).toUpperCase() + title.slice(1);
      return { text: `Done. It’s open on the right.\n---DOCUMENT---\n# ${t}\n\n_Demo mode: Jack’s AI isn’t connected to a model yet, so this is a sample layout._\n\n## Summary\n\n${ask}\n\n## Next step\n\nAdd the details, then download it as Word or PDF.`, sources: [] };
    }
    if (o.system.includes('---JACK---') && /\b(book|flight|browse|website|fill in|video|spreadsheet|excel|run (this|my) code|analy[sz]e (this|my) (file|pdf))\b/i.test(ask)) {
      return { text: `That needs the full Jack’s AI, which can work in a browser, read files and more.\n---JACK---`, sources: [] };
    }
    if (o.system.includes('SUMMARY')) {
      const lines = last.split('\n').filter((l) => l.includes(':')).slice(-3).map((l) => l.replace(/^\[[^\]]*\]\s*/, ''));
      return { text: `Demo summary (no AI model connected). Latest messages: ${lines.join(' · ') || 'nothing yet'}.`, sources: [] };
    }
    return { text: `Jack’s AI is in demo mode, so this is a sample answer.${o.search ? ' Web search needs a real model to be connected.' : ''} You asked: “${ask}”`, sources: [] };
  }
}

export function createAiProvider(c: Config, log: Logger): AiProvider {
  switch (c.aiDriver) {
    case 'anthropic': return new AnthropicProvider(c, log);
    case 'openrouter': return new OpenAiCompatProvider('openrouter', { baseUrl: c.OPENROUTER_BASE_URL, key: c.OPENROUTER_API_KEY!, model: c.AI_MODEL || 'openai/gpt-4o-mini', webUrl: c.WEB_URL }, log);
    case 'openai': return new OpenAiCompatProvider('openai', { baseUrl: c.OPENAI_BASE_URL, key: c.OPENAI_API_KEY!, model: c.AI_MODEL || 'gpt-4o-mini', webUrl: c.WEB_URL }, log);
    default: return new DevProvider();
  }
}
export const AI_PROVIDER = Symbol('AI_PROVIDER');
