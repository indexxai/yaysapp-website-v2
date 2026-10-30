import type { ReactNode } from 'react';
import { LineArt, type ArtName } from './ui';

/** The sign-in frame: the orange brand panel with the wordmark and line art, and the form beside it. */
export function AuthShell({ children, wide, art = 'chat' }: { children: ReactNode; wide?: boolean; art?: ArtName }) {
  return (
    <main className="auth-shell">
      <section className="auth-art" aria-hidden="true">
        <span className="ys-feature__deco a" style={{ width: 420, top: -150, right: -120 }} />
        <span className="ys-feature__deco b" style={{ width: 260, bottom: -90, left: -80 }} />
        <span className="auth-art__dots" />
        <img className="auth-art__logo" src="/brand/wordmark.png" alt="" width={180} height={49} />
        <LineArt key={art} name={art} height={360} ink="#ffffff" opacity={0.9} className="auth-art__art" />
        <div className="auth-art__copy">
          <h2>Your chats, on a bigger screen.</h2>
          <p>Messages, calls and communities stay in sync with your phone.</p>
        </div>
      </section>
      <section className="auth-panel"><div className={`auth-card${wide ? ' auth-card--wide' : ''}`}>{children}</div></section>
    </main>
  );
}
