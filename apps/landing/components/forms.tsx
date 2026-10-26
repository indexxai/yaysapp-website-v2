'use client';
import { useEffect } from 'react';
import { INDEXX_API } from '@/lib/links';

/** Ported from the old site's support.js: same endpoint, same fields, same messages. */
export function SupportForm() {
  useEffect(() => {
    const form = document.getElementById('support-form') as HTMLFormElement | null;
    const status = document.getElementById('support-status');
    const submit = document.getElementById('support-submit') as HTMLButtonElement | null;
    if (!form || !status || !submit) return;
    const show = (m: string, kind: string) => { status.textContent = m; status.className = `form-status show ${kind}`; };
    const onSubmit = async (e: Event) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      submit.disabled = true;
      show('Sending your request…', 'success');
      const f = form.elements as unknown as Record<string, HTMLInputElement>;
      try {
        const r = await fetch(`${INDEXX_API}/api/v1/inex/basic/emailToAdmin`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: String(f.name?.value || '').trim(), email: String(f.email?.value || '').trim().toLowerCase(), subject: 'YaysApp support — ' + String(f.subject?.value || 'Other'), message: String(f.message?.value || '').trim(), website: 'YAYSAPP-WEBSITE' }),
        });
        const body = await r.json().catch(() => ({}));
        if (!r.ok || (body.status && body.status >= 400)) throw new Error(body.message || 'Request failed');
        form.reset();
        show('Your support request was sent. We will reply by email.', 'success');
      } catch { show('We could not send the form. Please email support@bitcoinyay.com instead.', 'error'); }
      finally { submit.disabled = false; }
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);
  return null;
}

/** Ported from the old site's delete-account.js: verifies with email + password, then deletes. */
export function DeleteAccountForm() {
  useEffect(() => {
    const form = document.getElementById('delete-account-form') as HTMLFormElement | null;
    const status = document.getElementById('delete-status');
    const submit = document.getElementById('delete-submit') as HTMLButtonElement | null;
    if (!form || !status || !submit) return;
    const show = (m: string, kind: string) => { status.textContent = m; status.className = `form-status show ${kind}`; };
    const json = async (r: Response) => {
      const body = await r.json().catch(() => ({}));
      if (!r.ok || (body.status && body.status >= 400)) throw new Error((body?.data?.message as string) || body.message || 'The request could not be completed.');
      return body;
    };
    const onSubmit = async (e: Event) => {
      e.preventDefault();
      const f = form.elements as unknown as Record<string, HTMLInputElement>;
      const email = String(f.email?.value || '').trim().toLowerCase();
      const password = String(f.password?.value || '');
      const confirmation = String(f.confirmation?.value || '').trim();
      const ack = (document.getElementById('delete-ack') as HTMLInputElement | null)?.checked;
      if (!email || !password || confirmation !== 'DELETE' || !ack) { show('Enter your account details, type DELETE exactly, and confirm the acknowledgement.', 'error'); return; }
      if (!window.confirm(`Permanently delete the YaysApp account for ${email}? This cannot be undone.`)) return;
      submit.disabled = true;
      show('Verifying your account…', 'success');
      try {
        const login = await fetch(`${INDEXX_API}/api/v1/inex/user/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }).then(json);
        const token = login?.data?.access_token;
        if (!token) throw new Error('Could not verify this account.');
        show('Deleting your account…', 'success');
        await fetch(`${INDEXX_API}/api/v1/inex/user/deleteaccount`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ email }) }).then(json);
        form.reset();
        form.querySelectorAll('input, button').forEach((el) => { (el as HTMLInputElement).disabled = true; });
        show('Your YaysApp account has been deleted. You may now close this page.', 'success');
      } catch (err) {
        show(err instanceof Error && err.message ? err.message : 'We could not delete the account. Please try again or contact privacy@bitcoinyay.com.', 'error');
        submit.disabled = false;
      }
    };
    form.addEventListener('submit', onSubmit);
    return () => form.removeEventListener('submit', onSubmit);
  }, []);
  return null;
}
