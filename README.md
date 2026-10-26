# YaysApp v2

One repository for the new YaysApp: backend, web app, mobile app and landing site.

| Folder | What it is | Stack |
|---|---|---|
| `apps/api` | Backend: REST API now, real-time gateway from week 3 | NestJS, MongoDB, Redis |
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

In development no SMS or email is sent. The last code for a number or email is at
`http://localhost:4000/v1/_test/outbox?to=+923001234567` (only while `TEST_OUTBOX=true`).

## Tests

Each week's work ships with end-to-end tests that run against a real MongoDB replica set and Redis.

```bash
pnpm --filter @yays/api test:e2e        # backend: 57 tests
pnpm --filter @yays/web test:e2e        # browser: 11 tests (Playwright, desktop and phone)
pnpm --filter @yays/landing test:e2e    # landing: 19 tests
pnpm --filter @yays/mobile test         # mobile screens: 3 tests
pnpm --filter @yays/mobile test:e2e     # mobile screens against the live API: 6 tests
```

GitHub Actions runs the same suites on every push (`.github/workflows/ci.yml`).

## Rules that keep the old app and BTCY safe

- The `users` collection is shared with BTCY and the old app. v2 only writes fields under `users.yc`; nothing else on a user document is changed.
- v2's own data lives in collections starting with `yc_`. The old chat collections are read only.
- The indexes v2 adds to `users` are partial: they only cover documents that have the v2 field.
- A phone number is linked to an old account only after a code sent to that account's email is entered. The old app's unverified `phone` field is never used to link.
- The mobile app keeps the old app's identifiers (`com.indexx.yaysapp`) so the store treats v2 as an update.
