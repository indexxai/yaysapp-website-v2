'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
export function SettingsNav() {
  const path = usePathname();
  const items = [{ href: '/settings/profile', label: 'Profile' }, { href: '/settings/devices', label: 'Linked devices' }];
  return (
    <div className="ys-tabs" role="tablist" aria-label="Settings">
      {items.map((i) => <Link key={i.href} href={i.href} role="tab" className="ys-tab" aria-selected={path === i.href} style={{ textDecoration: 'none' }}>{i.label}</Link>)}
    </div>
  );
}
