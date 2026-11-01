'use client';
import type { SocialLink } from '@yays/shared';
import { Icon } from '@/lib/icons';
import { SOCIAL } from '@/lib/socials';

/** Someone's socials as cards: network, username, a tick when confirmed through that network. */
export function SocialChips({ links }: { links: SocialLink[] }) {
  return (
    <div className="p2-socials">
      {links.map((l) => {
        const n = SOCIAL[l.network];
        const inner = (
          <>
            <span style={{ position: 'relative', flex: 'none' }}>
              <span className="ys-oval" style={{ width: 36, ['--ys-oval-fill' as string]: n.fill, ['--ys-oval-ink' as string]: '#fff' }}><Icon name={n.icon} size={16} /></span>
              {l.verified && <span className="p2-verified" title="Verified"><Icon name="check" size={10} /></span>}
            </span>
            <span><strong>{n.name}</strong><small>{l.handle}{l.verified ? ' · verified' : ''}</small></span>
            {l.url && <Icon name="external" size={14} />}
          </>
        );
        return l.url
          ? <a key={l.network} className="p2-social" href={l.url} target="_blank" rel="noopener noreferrer" aria-label={`${n.name}: ${l.handle}${l.verified ? ', verified' : ''}`}>{inner}</a>
          : <div key={l.network} className="p2-social" aria-label={`${n.name}: ${l.handle}${l.verified ? ', verified' : ''}`}>{inner}</div>;
      })}
    </div>
  );
}
