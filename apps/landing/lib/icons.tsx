import icons from './icons.json';

/** YaysApp's icon set (a copy of packages/tokens icons.json; refresh with `pnpm -F @yays/landing sync`). */
const ICONS = icons as { stroke: Record<string, string[]>; solid: Record<string, string> };
export type IconName = keyof typeof icons.stroke | keyof typeof icons.solid;

export function Icon({ name, size = 20, title, strokeWidth = 1.8 }: { name: IconName; size?: number; title?: string; strokeWidth?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': title ? undefined : true, role: title ? 'img' : undefined, focusable: false as const };
  const solid = ICONS.solid[name as string];
  if (solid) return <svg {...common} fill="currentColor">{title && <title>{title}</title>}<path d={solid} /></svg>;
  const paths = ICONS.stroke[name as string] ?? ICONS.stroke.help;
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
      {title && <title>{title}</title>}
      {paths.map((d, i) => <path key={i} d={d} />)}
    </svg>
  );
}
