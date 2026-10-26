import type { ReactNode } from 'react';

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-shell">
      <section className="auth-art" aria-hidden="true">
        <span className="ys-feature__deco a" style={{ width: 420, top: -160, right: -120 }} />
        <span className="ys-feature__deco b" style={{ width: 260, bottom: 120, left: -90 }} />
        <h2>Chat. Earn. Together.</h2>
        <p>Messages, calls and communities, with your old YaysApp chats brought over.</p>
      </section>
      <section className="auth-panel"><div className="auth-card">{children}</div></section>
    </main>
  );
}
