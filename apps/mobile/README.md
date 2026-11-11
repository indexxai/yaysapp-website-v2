# YaysApp mobile (React Native)

The iPhone and Android app. React Native 0.78, TypeScript, React Navigation. It uses the same chat engine and API
client as the web app (`packages/shared`) and the same colours and icons (`packages/tokens`).

Tabs, as in the design: **Chats · Calls · Circles · Explore · Me**.

## Run it on a Mac

Once, from the repo root:

```bash
pnpm install
pnpm -F @yays/tokens build && pnpm -F @yays/shared build
```

Start the API (it must be on http://localhost:4000): double-click `start-mac.command`, or `pnpm -F @yays/api dev`.

### iPhone simulator (needs Xcode)

```bash
cd apps/mobile/ios
bundle install            # once: installs CocoaPods
bundle exec pod install   # once, and after adding a native package
cd ..
pnpm ios                  # builds, opens the simulator and starts Metro
```

### Android emulator (needs Android Studio)

Open an emulator from Android Studio's Device Manager first, then:

```bash
cd apps/mobile
pnpm android
```

The emulator reaches your Mac's API at `10.0.2.2:4000`; the iPhone simulator at `localhost:4000`
(`src/lib/config.ts`).

Sign in with your phone number or email. With the API in development mode no SMS or email is sent: the code is at
http://localhost:4000/v1/_test/outbox?to=you@example.com (use `%2B` for the `+` of a phone number).

### Calls

Voice and video calls go through LiveKit, like on the web. The API needs `LIVEKIT_URL`, `LIVEKIT_API_KEY` and
`LIVEKIT_API_SECRET` in `apps/api/.env` (see `.env.example`), with your LiveKit server running.

- **After pulling this**, rebuild the app: `cd ios && bundle exec pod install`, then `pnpm ios` / `pnpm android`.
  The calls package is native, so a Metro reload is not enough.
- **Test calls on real phones.** The iPhone simulator can't use a camera or microphone (LiveKit's own note), so a call
  from it connects but sends nothing. The Android emulator can, with its virtual camera and microphone.
- In development the app reaches LiveKit on the same host as the API, so the Android emulator's `10.0.2.2` works for
  both. A real phone on your Wi-Fi needs your Mac's address: change `devUrl` in `src/lib/config.ts` to
  `http://<your Mac's IP>:4000`, and start LiveKit with `--bind 0.0.0.0` so the phone can reach it. LiveKit's address
  then follows the API's.
- A call rings the phone while YaysApp is open. Ringing a phone that is locked or closed needs push notifications,
  which come next.

## Check it

```bash
pnpm typecheck
pnpm test                 # screens and components
pnpm test:e2e             # the app against a real API, MongoDB and Redis (started for you)
```

## Fonts and art

Outfit (headings) and Nunito Sans (text) are in `assets/fonts`, one file per weight. They're already added to the
iOS and Android projects; after adding or renaming a font, run `npx react-native-asset`. Always use `Text` and
`TextInput` from `src/ui/Text`, not from `react-native`: they pick the right font file for the weight.

The background art is in `assets/lineart` (the same pictures as the web), drawn with `src/ui/LineArt`.
