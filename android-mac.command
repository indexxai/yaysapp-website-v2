#!/bin/bash
# YaysApp's Android app on this Mac: builds it, starts the database, Redis, the call server, the API and Metro,
# opens an Android emulator (or uses a plugged-in phone) and launches the app on it.
# Double-click it in Finder. Close this window (or press Ctrl+C) to stop everything.
# Everything is also written to android-run.log next to this file.
cd "$(dirname "$0")"
LOG="$PWD/android-run.log"
: > "$LOG"
exec > >(tee -a "$LOG") 2>&1
step() { printf "\n\033[1;33m▶ %s\033[0m\n" "$1"; echo "STEP: $1" >> "$LOG.steps"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$1"; echo "FAILED: $1" >> "$LOG.steps"; echo; read -r -p "Press Enter to close." _; exit 1; }
: > "$LOG.steps"

# ---- tools: Homebrew, Node (nvm or Homebrew), pnpm, Android SDK, Java ----
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
command -v node >/dev/null || fail "Node.js isn't installed. Double-click start-mac.command once first, then this again."
command -v pnpm >/dev/null || { step "Installing pnpm"; npm install -g pnpm@10 || corepack enable pnpm; }
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -d "$ANDROID_HOME" ] || fail "The Android SDK isn't at $ANDROID_HOME. Open Android Studio once and let it install the SDK."
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
if [ -z "$JAVA_HOME" ]; then
  for j in "/Applications/Android Studio.app/Contents/jbr/Contents/Home" "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home"; do
    [ -d "$j" ] && export JAVA_HOME="$j" && break
  done
fi
export NODE_BINARY="$(command -v node)"
step "Tools"
echo "node $(node -v) at $NODE_BINARY · pnpm $(pnpm -v) · JAVA_HOME=$JAVA_HOME · SDK $ANDROID_HOME"
"$JAVA_HOME/bin/java" -version 2>&1 | head -1

# ---- packages ----
step "Installing packages"
pnpm install || fail "pnpm install failed (see above)."
pnpm --filter @yays/tokens build >/dev/null && pnpm --filter @yays/shared build >/dev/null || fail "Building the shared code failed."

# ---- build the app ----
step "Building the Android app (the first time takes 5–15 minutes)"
APK=apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk
STAMP="$(mktemp)"
if ! ( cd apps/mobile/android && ./gradlew :app:assembleDebug --console=plain ); then
  # Some Gradle versions fail while writing their report after the app is built; a fresh app file means it worked.
  [ "$APK" -nt "$STAMP" ] || fail "The Android build failed (see the lines above)."
  echo "(Gradle reported an error after the app was built; carrying on.)"
fi
echo "BUILD_OK" >> "$LOG.steps"

# ---- server: MongoDB, Redis, LiveKit, API ----
[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env
step "Starting MongoDB and Redis"
pnpm infra:up || fail "MongoDB/Redis didn't start. Double-click start-mac.command once (it installs them), then this again."
pids=()
stop() { echo; step "Stopping"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; pkill -f "livekit-server --dev" 2>/dev/null || true; exit 0; }
trap stop INT TERM HUP
if command -v livekit-server >/dev/null && ! nc -z 127.0.0.1 7880 2>/dev/null; then
  livekit-server --dev --bind 0.0.0.0 > infra/.data/livekit.log 2>&1 & pids+=($!)
fi
if ! curl -sf -o /dev/null http://localhost:4000/v1/health; then
  step "Starting the API on http://localhost:4000"
  pnpm --filter @yays/api dev > api-run.log 2>&1 & pids+=($!)
fi

# ---- a phone: plugged in, or an emulator ----
step "Finding an Android phone or emulator"
adb start-server >/dev/null 2>&1
if ! adb devices | grep -q "device$"; then
  AVD="$(emulator -list-avds 2>/dev/null | head -1)"
  [ -n "$AVD" ] || fail "There's no emulator yet. In Android Studio: Device Manager › + › Create Virtual Device (a Pixel), then run this again."
  echo "Opening the emulator $AVD"
  emulator -avd "$AVD" > emulator.log 2>&1 &
  adb wait-for-device
  for _ in $(seq 1 120); do [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] && break; sleep 2; done
fi
adb devices
# A real phone reaches this Mac's API and Metro through USB.
adb reverse tcp:4000 tcp:4000 >/dev/null 2>&1; adb reverse tcp:8081 tcp:8081 >/dev/null 2>&1; adb reverse tcp:7880 tcp:7880 >/dev/null 2>&1

# ---- Metro, then install and open ----
if ! nc -z 127.0.0.1 8081 2>/dev/null; then
  step "Starting Metro (serves the app's code)"
  ( cd apps/mobile && pnpm start > ../../metro-run.log 2>&1 ) & pids+=($!)
  for _ in $(seq 1 60); do nc -z 127.0.0.1 8081 2>/dev/null && break; sleep 1; done
fi
for _ in $(seq 1 90); do curl -sf -o /dev/null http://localhost:4000/v1/health && break; sleep 2; done
step "Installing and opening YaysApp"
adb install -r "$APK" || fail "Installing the app failed."
PKG="$(grep -m1 applicationId apps/mobile/android/app/build.gradle | sed -E 's/.*"([^"]+)".*/\1/')"
adb shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
echo "RUNNING" >> "$LOG.steps"
printf "\n\033[1;32m✔ YaysApp is running on the emulator\033[0m\n"
echo "  Sign-in codes aren't sent in development: http://localhost:4000/v1/_test/outbox?to=YOUR_NUMBER_OR_EMAIL"
echo "  Logs: api-run.log, metro-run.log. Keep this window open; close it or press Ctrl+C to stop."
wait
