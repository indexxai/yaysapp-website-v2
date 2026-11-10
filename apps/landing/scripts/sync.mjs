// Copies the web app's styles, art and the design tokens into this site, so it looks the same as the web app and
// still builds on its own (yaysapp-landing-v2). Run after changing them in apps/web or packages/tokens.
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
const web = new URL('../../web/', import.meta.url), here = new URL('../', import.meta.url);
for (const f of ['yays', 'app', 'phase2', 'circles']) cpSync(new URL(`styles/${f}.css`, web), new URL(`styles/${f}.css`, here));
for (const d of ['lineart', 'illustrations']) cpSync(new URL(`public/${d}/`, web), new URL(`public/${d}/`, here), { recursive: true });
const tokens = new URL('../../../packages/tokens/dist/', import.meta.url);
writeFileSync(new URL('styles/tokens.css', here), `/* Copied from packages/tokens/dist/tokens.css (generated from tokens.json). Refresh with: pnpm -F @yays/landing sync */\n${readFileSync(new URL('tokens.css', tokens), 'utf8')}`);
cpSync(new URL('icons.json', tokens), new URL('lib/icons.json', here));
console.log('Copied styles, art, tokens and icons from the web app.');
