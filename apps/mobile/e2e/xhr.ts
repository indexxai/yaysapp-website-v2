/**
 * Uploads in the app go through XMLHttpRequest (for progress). The test runner has no phone networking, so this is a
 * small XMLHttpRequest that sends with fetch to the real test server.
 */
class TestXhr {
  status = 0;
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  onload?: () => void; onerror?: () => void; onabort?: () => void;
  private method = 'GET'; private url = ''; private headers: Record<string, string> = {}; private ctrl = new AbortController();
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(k: string, v: string) { this.headers[k] = v; }
  abort() { this.ctrl.abort(); this.onabort?.(); }
  send(body?: Blob) {
    fetch(this.url, { method: this.method, headers: this.headers, body, signal: this.ctrl.signal })
      .then(async (r) => {
        this.status = r.status; await r.arrayBuffer();
        const n = body?.size ?? 0;
        this.upload.onprogress?.({ lengthComputable: true, loaded: n, total: n });
        this.onload?.();
      })
      .catch(() => { if (!this.ctrl.signal.aborted) this.onerror?.(); });
  }
}
(globalThis as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = TestXhr;
