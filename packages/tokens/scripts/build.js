// Generates tokens.css (web) and index.js/.d.ts (web + React Native) from tokens.json,
// the same file the YaysApp design system publishes. One source, three outputs.
const fs = require('fs');
const path = require('path');
const src = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/tokens.json'), 'utf8'));
const out = path.join(__dirname, '../dist');
fs.mkdirSync(out, { recursive: true });

const color = { light: {}, dark: {} };
const ref = /^\{([a-z0-9-]+)\}$/;
for (const t of src.color.tokens) for (const theme of ['light', 'dark']) color[theme][t.name] = t.value[theme];
for (const theme of ['light', 'dark'])
  for (const [k, v] of Object.entries(color[theme])) {
    const m = ref.exec(v);
    if (m) {
      if (!(m[1] in color[theme])) throw new Error(`token ${k} points at missing ${m[1]}`);
      color[theme][k] = color[theme][m[1]];
    }
  }
const flat = (group) => Object.fromEntries((src[group]?.tokens || []).map((t) => [t.name, t.value]));
const space = flat('spacing'), radius = flat('radius'), size = flat('size'), oval = flat('oval');
const shadow = { light: {}, dark: {} };
for (const t of src.shadow.tokens) { shadow.light[t.name] = t.value.light; shadow.dark[t.name] = t.value.dark; }

const vars = (obj) => Object.entries(obj).map(([k, v]) => `  --${k}: ${v};`).join('\n');
const css = `/* Generated from tokens.json. Do not edit by hand. */
:root, [data-theme="light"] {
${vars(color.light)}
${vars(shadow.light)}
}
[data-theme="dark"] {
${vars(color.dark)}
${vars(shadow.dark)}
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
${vars(color.dark).replace(/^/gm, '  ')}
${vars(shadow.dark).replace(/^/gm, '  ')}
  }
}
:root {
${vars(space)}
${vars(radius)}
${vars(size)}
${vars(oval)}
  --font-display: ${src.type.families.display};
  --font-body: ${src.type.families.body};
}
`;
fs.writeFileSync(path.join(out, 'tokens.css'), css);

const px = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /px$/.test(v) ? Number(v.slice(0, -2)) : v]));
const data = { color, shadow, space: px(space), radius: px(radius), size: px(size), ovalAspect: 1133 / 1052, ovalTilt: -38.3,
  font: { display: 'Outfit', body: 'Nunito Sans' } };
fs.writeFileSync(path.join(out, 'index.js'), `"use strict";\n// Generated from tokens.json.\nmodule.exports = ${JSON.stringify(data, null, 2)};\n`);
const keys = (o) => Object.keys(o).map((k) => JSON.stringify(k)).join(' | ');
fs.writeFileSync(path.join(out, 'index.d.ts'), `export type ColorToken = ${keys(color.light)};
export type ThemeName = 'light' | 'dark';
export declare const color: Record<ThemeName, Record<ColorToken, string>>;
export declare const shadow: Record<ThemeName, Record<string, string>>;
export declare const space: Record<${keys(space)}, number>;
export declare const radius: Record<${keys(radius)}, number>;
export declare const size: Record<${keys(size)}, number>;
export declare const ovalAspect: number;
export declare const ovalTilt: number;
export declare const font: { display: string; body: string };
`);
fs.copyFileSync(path.join(__dirname, '../src/icons.json'), path.join(out, 'icons.json'));
console.log(`tokens: ${Object.keys(color.light).length} colours, ${Object.keys(space).length} spacing steps`);
