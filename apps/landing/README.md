# YaysApp website

The public website at yaysapp.com: the home page, **Support**, **Privacy**, **Terms** and **Delete account**.

The home page is the same page the YaysApp web app shows to signed-out visitors (`apps/web/components/landing.tsx`),
with the same styles, art and Ask Jack assistant. Its "Open web app" buttons go to the web app.

It's a **static site**: `npm run build` writes plain HTML, CSS and images to `out/`. Nothing runs on a server.

## Run it

Needs Node 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3200
```

## Build and host

Set where the site sends people, then build:

```bash
NEXT_PUBLIC_WEB_APP_URL=https://web.yaysapp.com \
NEXT_PUBLIC_API_URL=https://api.yaysapp.com \
npm run build      # writes the site to out/
```

| Setting | What it's for | If not set |
|---|---|---|
| `NEXT_PUBLIC_WEB_APP_URL` | The YaysApp web app ("Open web app" buttons) | `https://web.yaysapp.com` (development: `http://localhost:3000`) |
| `NEXT_PUBLIC_API_URL` | The YaysApp API, for the Ask Jack assistant | `https://api.yaysapp.com` (development: `http://localhost:4000`) |

The API must allow this site's address in its `CORS_ORIGINS`, or Ask Jack can't answer.

Upload the contents of `out/` to any static host (Netlify, Vercel, Cloudflare Pages, S3 + CloudFront, nginx).
Pages are written as `privacy.html`, `terms.html` and so on. Most hosts serve `/privacy` from `privacy.html` on
their own; on nginx add `try_files $uri $uri.html $uri/ =404;`.

## Test it

```bash
npx playwright install chromium   # once
npm run test:e2e                  # builds, then checks every page on desktop and phone
```

## Where things are

| What | Where |
|---|---|
| Home page, header, footer, Ask Jack | `components/landing.tsx` |
| Privacy, Terms, Support and Delete account wording | `content/*.html`, shown word for word. Change the legal wording only with approval. |
| Support and Delete account forms | `components/forms.tsx` (they post to the Indexx API) |
| Styles | `styles/yays.css`, `app.css`, `phase2.css`, `circles.css`: copies of the web app's; `styles/site.css`: the legal pages |
| Colours and type, icons | `styles/tokens.css`, `lib/icons.json`: copies of the design tokens |
| Art, logos | `public/lineart`, `public/brand` |
| Links (web app, API, Google Play) | `lib/links.ts` |

**In the YaysApp project** (`yaysapp-website-v2`, folder `apps/landing`): after changing the web app's landing page,
copy `components/landing.tsx` across, and run `pnpm -F @yays/landing sync` to copy the web app's styles, art,
tokens and icons. The standalone repo (`yaysapp-landing-v2`) is published from there.
