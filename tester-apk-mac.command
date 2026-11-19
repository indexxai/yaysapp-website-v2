#!/bin/bash
# Builds an Android APK to send to testers: the app's code is inside it (no Metro needed) and it talks to the
# production API (https://api.yaysapp.com, set in apps/mobile/src/lib/config.ts). Double-click it in Finder.
# The APK lands next to this repo's folder as YaysApp-<version>-tester.apk. Log: tester-apk.log.
# Note: it is signed with the debug key, which is fine for testers but not for the Play Store.
cd "$(dirname "$0")"
LOG="$PWD/tester-apk.log"
: > "$LOG"; : > "$LOG.steps"
exec > >(tee -a "$LOG") 2>&1
step() { printf "\n\033[1;33m▶ %s\033[0m\n" "$1"; echo "STEP: $1" >> "$LOG.steps"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$1"; echo "FAILED: $1" >> "$LOG.steps"; echo; read -r -p "Press Enter to close." _; exit 1; }

for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
command -v node >/dev/null || fail "Node.js isn't installed."
command -v pnpm >/dev/null || npm install -g pnpm@10 || corepack enable pnpm
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
[ -d "$ANDROID_HOME" ] || fail "The Android SDK isn't at $ANDROID_HOME. Open Android Studio once and let it install the SDK."
if [ -z "$JAVA_HOME" ]; then
  for j in "/Applications/Android Studio.app/Contents/jbr/Contents/Home" "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home"; do
    [ -d "$j" ] && export JAVA_HOME="$j" && break
  done
fi
export NODE_BINARY="$(command -v node)"
step "Tools"
echo "node $(node -v) · pnpm $(pnpm -v) · JAVA_HOME=$JAVA_HOME"

step "Installing packages"
pnpm install >/dev/null || fail "pnpm install failed."
pnpm --filter @yays/tokens build >/dev/null && pnpm --filter @yays/shared build >/dev/null || fail "Building the shared code failed."

step "Building the tester APK (5–15 minutes)"
APK=apps/mobile/android/app/build/outputs/apk/release/app-release.apk
STAMP="$(mktemp)"
# Real phones only (64-bit and older 32-bit ARM); emulators on a Mac use arm64 too.
if ! ( cd apps/mobile/android && ./gradlew :app:assembleRelease --console=plain -PreactNativeArchitectures=arm64-v8a,armeabi-v7a ); then
  [ "$APK" -nt "$STAMP" ] || fail "The Android build failed (see the lines above)."
  echo "(Gradle reported an error after the APK was built; carrying on.)"
fi
[ "$APK" -nt "$STAMP" ] || fail "No new APK was made."

VER="$(grep -m1 versionName apps/mobile/android/app/build.gradle | sed -E 's/.*"([^"]+)".*/\1/')"
OUT="../YaysApp-$VER-tester.apk"
cp "$APK" "$OUT" || fail "Couldn't copy the APK."
echo "APK=$(cd .. && pwd)/YaysApp-$VER-tester.apk" >> "$LOG.steps"
echo "BUILD_OK" >> "$LOG.steps"
step "Done: $OUT ($(du -h "$OUT" | cut -f1))"
open -R "$OUT" 2>/dev/null
read -r -p "Press Enter to close." _
