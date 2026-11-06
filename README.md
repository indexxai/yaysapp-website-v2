# YaysApp v2

One repository for the new YaysApp: backend, web app, mobile app and landing site.

| Folder | What it is | Stack |
|---|---|---|
| `apps/api` | Backend: REST API and the real-time gateway (`/v1/socket`) | NestJS, Socket.IO, MongoDB, Redis |
| `apps/web` | Web app (YaysApp in the browser) | Next.js 15, React 19 |
| `apps/mobile` | Android and iPhone app (`com.indexx.yaysapp`, v2.0.0 build 29) | React Native 0.78 |
| `apps/landing` | Public site: home, privacy, terms, support, delete account | Next.js static export |
| `packages/shared` | Types, validation and the API client used by web and mobile | TypeScript |
| `packages/tokens` | Design tokens and icons from the YaysApp design system | JSON → CSS + JS |
| `infra` | Scripts that start MongoDB and Redis locally and for tests | Bash, Node |

## Run it locally

Needs Node 22, pnpm 10, MongoDB 7+ and Redis 7+ (`brew install mongodb-community redis` on a Mac).

```bash
pnpm install
pnpm --filter @yays/tokens build && pnpm --filter @yays/shared build
pnpm infra:up                               # MongoDB replica set on 27018, Redis on 6380
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
pnpm --filter @yays/api dev                 # http://localhost:4000/v1/health
pnpm --filter @yays/web dev                 # http://localhost:3000
pnpm --filter @yays/landing dev             # http://localhost:3200
cd apps/mobile && npx react-native start    # then: npx react-native run-android
                                            # iPhone: cd ios && pod install, then run from Xcode
```

Calls need a LiveKit server (1.12 or newer): `brew install livekit`, then `livekit-server --dev`
in another terminal, and uncomment the `LIVEKIT_*` lines in `apps/api/.env` (the dev keys match).
Without it everything else works and calls say they aren't available.

In development no SMS or email is sent. The last code for a number or email is at
`http://localhost:4000/v1/_test/outbox?to=+923001234567` (only while `TEST_OUTBOX=true`).

## Tests

Each week's work ships with end-to-end tests that run against a real MongoDB replica set and Redis.

```bash
pnpm --filter @yays/api test:e2e        # backend and chat engine: 126 tests
pnpm --filter @yays/web test:e2e        # browser: 35 tests (Playwright, desktop and phone)
pnpm --filter @yays/landing test:e2e    # landing: 19 tests
pnpm --filter @yays/mobile test         # mobile screens: 3 tests
pnpm --filter @yays/mobile test:e2e     # mobile screens against the live API: 10 tests
pnpm --filter @yays/shared test         # shared rules (ticks, text limits, dates, group lines): 17 tests
```

GitHub Actions runs the same suites on every push (`.github/workflows/ci.yml`).

## How messaging works (week 3)

- A chat is a row in `yc_conversations`; each message in `yc_messages` gets the next number (`seq`) inside a
  MongoDB transaction. That is why MongoDB must run as a replica set: the number, the message and the sender's
  receipt are written together, so numbers never skip and never repeat.
- Every message carries a `clientId` chosen by the sending device. Sending it again (after a dropped connection,
  an app restart, or a lost answer) returns the first copy instead of making a second one.
- Ticks come from `yc_receipts`: one row per person per chat with how far they have received and read.
- Apps talk to `/v1/socket` (Socket.IO). With several API servers, the Redis adapter passes events between them.
  Signing a device out closes its live connection at once, on whichever server holds it.
- Web and mobile share one `ChatEngine` (`packages/shared/src/engine.ts`): the chat list, threads, ticks, typing,
  online status, an unsent queue kept on the device, retries, and catching up after being offline. The chat list
  and recent messages are also kept on the device, so chats open with no signal.

## Rules that keep the old app and BTCY safe

- The `users` collection is shared with BTCY and the old app. v2 only writes fields under `users.yc`; nothing else on a user document is changed.
- v2's own data lives in collections starting with `yc_`. The old chat collections are read only.
- The indexes v2 adds to `users` are partial: they only cover documents that have the v2 field.
- A phone number is linked to an old account only after a code sent to that account's email is entered. The old app's unverified `phone` field is never used to link.
- The mobile app keeps the old app's identifiers (`com.indexx.yaysapp`) so the store treats v2 as an update.

## Phase 2: points, wallet, Jack's AI

- **INEX** rewards (Indexx's own coin; called points in code and the database) are a ledger (`yc_points_ledger`); every award has a key, so nothing pays twice. Daily check-in (7-day cycle), everyday tasks (capped at 200 a day), invites (pending until the friend verifies a phone number and sends a first message), and two bonus campaigns: Jack's AI (daily, all tasks required) and BTCY (weekly, each task pays). Days follow the person's own time zone (the apps send `X-Time-Zone`).
- **Pop-ups** as the app opens: check-in first, then one bonus at a time, each at most once a day on any device (`GET /v1/rewards/popup`).
- **Indexx account** (BTCY, the USDXX balance (read-only), Exchange, EMMM) goes through `IndexxProvider`. `INDEXX_DRIVER=dev` is a stand-in kept in this database so every screen works locally; production uses `off` until the real Indexx API is connected (one class to write: `apps/api/src/indexx/indexx.provider.ts`).
- **Jack's AI** (the light version inside YaysApp): conversations, pictures (one per request, made and changed in the conversation, 5 a day by default, sendable into any chat as a photo), documents (download as Word or PDF, or send into a chat), web answers with sources, chat summaries (asks first, per chat), the Support desk's first answer and the website's Ask Jack box. Specialised work (websites, bookings, files, video, code) gets a short answer and a link to the full Jack's AI (`JACK_AI_URL`). Talking uses OpenRouter (`OPENROUTER_API_KEY`, any model in `AI_MODEL`) or OpenAI (`OPENAI_API_KEY`); pictures use OpenAI's image model; with no keys it gives labelled sample answers. 30 free messages a day; 50 INEX buy 10 more.
- **Website**: signed-out visitors to `/` see the landing page; `/?ref=CODE` keeps an invite code for sign-up.

## Yays Circle (communities became circles)

A circle is a community underneath (same id, members, admins and group chats) with a feed, events and a few more settings. The **Circles** tab replaces Communities; old `/communities` links open the circle's Chats tab.

- **Public or private.** Public: anyone can read and join at once. Private: only About and rules show; people answer the owners' question and wait. Requests lapse after 7 days. After a "no", or after being removed, people can ask again in 30 days (`yc_circle_bars`). Private circles can be hidden from Discover.
- **Official.** Only circles YaysApp has checked are official; set `official: true` on the circle in `yc_communities` (there is no API for it on purpose). Other circles can't use "official" in their name, and names that look like an official circle's are marked **Not official**.
- **Feed.** Posts with up to 4 photos, likes, comments with one level of replies, owners mark the answer, pin up to 3 posts, and optionally approve posts first. Posts, comments and events that promise profits or ask for money (`moneySchemeMatches` in `packages/shared/src/circles.ts`) are stopped; the writer can send them to the owners instead, who see them under **Review** with reported posts.
- **Safety.** Reporting hides the post for the reporter (and can block the author). Owners mute people for 1 to 30 days (they can still read) or remove them with a reason they see.
- **Events.** In person, online or both; the online link shows only to people going. Seat limits with a waitlist: a freed seat is offered to the next person for 12 hours. Moving the time or place asks people going "still going?". Cancelled events keep the host's message; ended ones take a recording, slides and ratings from people who went.
- Not built yet: push reminders before events, photos for circle banners, mobile screens.

## Demo data

With the app running locally (start-mac.command), double-click **demo-mac.command** (or run `pnpm demo`).
It signs up Sara Ahmed and 14 friends, writes chats with photos, a voice note, a PDF, replies, reactions,
a poll and pinned and starred messages, adds groups, circles with posts, events and things to review
(an official Bitcoin YAY Circle, a private one, a full event with a waitlist, a changed and a cancelled event)
and call history, spreads it over the last week, and opens the app signed in as Sara.

- `pnpm demo --link` prints a fresh sign-in link for Sara.
- `pnpm demo --reset` removes the demo people and everything they made, then seeds again.
- Sara's own sign-in: phone 0300 0000001; the code is at http://localhost:4000/v1/_test/outbox?to=%2B923000000001

Local development only: the script reads apps/api/.env and refuses production settings or a non-local database.
