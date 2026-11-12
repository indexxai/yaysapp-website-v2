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
- **Ringing when YaysApp is closed or the phone is locked**, like a phone call:
  - **iPhone**: the server sends a VoIP push and the call shows on the iPhone's own call screen (CallKit), with Answer
    and Decline on the lock screen. It uses the same Apple key as notifications (`APNS_KEY_FILE` …); the app asks
    for the VoIP token by itself. `Info.plist` has the "Voice over IP" background mode. Test on a real iPhone: the
    simulator doesn't get VoIP pushes. (Apple doesn't allow CallKit in apps sold in mainland China.)
  - **Android**: the server sends a data-only push and the app shows a full-screen call notification that rings until
    answered or declined (Notifee), with Answer and Decline. It needs `google-services.json` (see Notifications).
    Google Play asks calling apps to declare the full-screen permission (Play Console › App content).
  - **After pulling this**: `cd ios && bundle exec pod install`, then rebuild (three new native packages).

### Google and Facebook sign-in

The sign-in screen has **Facebook** and **Google** under the phone number, as in the design.

- **Google.** In development, without client ids, the Google button opens a stand-in that asks for an email (it needs
  the API's `GOOGLE_DRIVER=dev`). For real Google sign-in, in Google Cloud console › APIs & Services › Credentials,
  create three OAuth client ids:
  - **Web application**: put it in `src/lib/config.ts` as `google.webClientId`. Google signs the app's token for this one.
  - **iOS**, bundle id `com.indexx.yaysapp`: put it in `google.iosClientId`, and its "iOS URL scheme" in
    `ios/YaysApp/Info.plist` in place of `com.googleusercontent.apps.REPLACE-WITH-IOS-CLIENT`.
  - **Android**, package `com.indexx.yaysapp` with your signing key's SHA-1 (`cd android && ./gradlew signingReport`,
    and Play Console's app signing key for releases). Nothing to paste; Google matches the app by these.

  On the API: `GOOGLE_DRIVER=google` and `GOOGLE_CLIENT_IDS=<web id>,<iOS id>`.
- **Facebook** needs nothing in the app. It uses the API's Facebook settings (`FACEBOOK_DRIVER`, `FACEBOOK_APP_ID`,
  `FACEBOOK_APP_SECRET`), opens Facebook in a sign-in browser and comes back on `yaysapp://`. Facebook signs in only
  accounts that linked it (Settings › Social accounts on the web).

### Circles

The Circles tab works as on the web: your circles and coming events, Discover (search, categories, featured), and
each circle's Feed, Events, Chats and About. Members post (text and up to 4 photos), like, comment, report and RSVP;
private circles take join requests. Owners also get Members (mute, remove) and Review (approve, settle reports), and
edit the circle's settings. Posts that promise profits or ask for money are caught before they go, as on the web.
Nothing native is added: no rebuild needed for this one.

### Links that open the app

Group invites (`web.yaysapp.com/join/…`), circle invites (`/c/…`), circles, posts and events (`/circles…`) open
YaysApp when it's installed, and invite codes (`/?ref=…`) count for whoever shared them. The same paths work on
`yaysapp://`. A link opened before signing in waits until the person is signed in.

- **iPhone**: `ios/YaysApp/YaysApp.entitlements` has Associated Domains for `web.yaysapp.com` (and the push
  entitlement). In Xcode › Signing & Capabilities they show as Associated Domains and Push Notifications.
- **Android**: App Links for the same paths (`AndroidManifest.xml`).
- **The web app** serves the files Apple and Google check (`/.well-known/apple-app-site-association` and
  `/.well-known/assetlinks.json`) once it has `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` (see `apps/web/.env.example`).
  For Android, use both fingerprints: your upload key (`cd android && ./gradlew signingReport`) and Google Play's app
  signing key (Play Console › Test and release › App integrity).

Production addresses (`src/lib/config.ts`) are the ones the public site uses: the API at `api.yaysapp.com`, the web
app at `web.yaysapp.com`, the site at `yaysapp.com`.

### Catch up in a chat

The sparkles button in a chat's header asks Jack's AI for a short summary of the chat. It asks once per chat first
(text, names and times are sent; photos, voice notes and phone numbers are not), and can be turned off from the
summary. As on the web, there is no money in chats.

### Explore

The Explore tab: Jack's AI (chat, web answers with sources, documents and pictures, sent to a chat if you like),
the daily check-in, Earn (tasks, bonuses, INEX history, invites), the Wallet (INEX, BTCY Nuggets, USDXX and Indexx
Exchange; withdraw INEX to the exchange), BTCY and the other Indexx products, and Help (Jack answers first, then
a person). The check-in or a bonus pops up once a day as the app opens. Indexx account and Help are also on the Me tab.

- In development the API's stand-ins answer: `INDEXX_DRIVER=dev` signs in to Indexx with any password except
  `wrong-password`, and `AI_DRIVER=dev` gives sample answers and plain sample pictures. For real data set
  `INDEXX_DRIVER=live` and an AI key (`OPENROUTER_API_KEY` or `OPENAI_API_KEY`) in `apps/api/.env`.
- Nothing native is added.

### Notifications

Messages and calls notify the phone when YaysApp isn't open. Android uses Firebase Cloud Messaging; iPhone uses
Apple's push service directly (no Firebase on iOS).

- **Android**: in the [Firebase console](https://console.firebase.google.com), add an Android app with package
  `com.indexx.yaysapp` and put its `google-services.json` in `android/app/`. Without that file the app builds and
  runs with notifications off.
- **iPhone**: in Xcode › YaysApp target › Signing & Capabilities, add **Push Notifications** (this needs a paid Apple
  developer team). Test on a real iPhone, or a simulator on an Apple-silicon Mac.
- **API** (`apps/api/.env`), with `PUSH_DRIVER=webpush`:
  - Android: Firebase console › Project settings › Service accounts › Generate new private key, then
    `FCM_SERVICE_ACCOUNT_FILE=/path/to/that.json`.
  - iPhone: developer.apple.com › Certificates, IDs & Profiles › Keys › new key with Apple Push Notifications service,
    then `APNS_KEY_FILE=/path/to/AuthKey_XXXX.p8`, `APNS_KEY_ID=XXXX`, `APNS_TEAM_ID=<your team id>`.
  - `GET /v1/push/config` shows `"phones": { "android": true, "ios": true }` when both are set.

## Check it

```bash
pnpm typecheck
pnpm test                 # screens and components
pnpm test:e2e             # the app against a real API, MongoDB and Redis (started for you)
```

## Fonts and art

Videos sent from the phone carry a still from the video as their preview (`react-native-create-thumbnail`), as on the
web. After pulling this: `bundle exec pod install` and rebuild.

Outfit (headings) and Nunito Sans (text) are in `assets/fonts`, one file per weight. They're already added to the
iOS and Android projects; after adding or renaming a font, run `npx react-native-asset`. Always use `Text` and
`TextInput` from `src/ui/Text`, not from `react-native`: they pick the right font file for the weight.

The background art is in `assets/lineart` (the same pictures as the web), drawn with `src/ui/LineArt`.
