#!/bin/bash
# Builds YaysApp for Google Play: an Android App Bundle (.aab) signed with the Play upload key, talking to the
# production API (https://api.yaysapp.com). Double-click it in Finder, then upload the .aab in Play Console
# (YaysApp › Test and release › Production or Internal testing › Create new release).
#
# Needs, next to this repo's folder (never inside it):
#   secrets/yaysapp-upload.properties  – where the upload key is and its passwords
#   secrets/google-services.json       – optional; Android push notifications (Firebase). Copied into the app.
# Each run gets a new version code (date and time), so it can be run again any time.
cd "$(dirname "$0")"
ROOT="$PWD"; SECRETS="$ROOT/../secrets"
LOG="$ROOT/play-release.log"
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

step "Upload key and Firebase"
PROPS="$SECRETS/yaysapp-upload.properties"
[ -f "$PROPS" ] || fail "No upload key settings at $PROPS."
KEYFILE="$(grep -E '^YAYS_UPLOAD_STORE_FILE=' "$PROPS" | cut -d= -f2-)"
[ -f "$KEYFILE" ] || fail "The upload key file isn't at $KEYFILE."
if [ -f "$SECRETS/google-services.json" ]; then
  cp "$SECRETS/google-services.json" apps/mobile/android/app/google-services.json
  echo "Firebase: on (push notifications)"
else
  echo "Firebase: off — no secrets/google-services.json, so this build has no Android push notifications."
fi

step "Installing packages"
pnpm install >/dev/null || fail "pnpm install failed."
pnpm --filter @yays/tokens build >/dev/null && pnpm --filter @yays/shared build >/dev/null || fail "Building the shared code failed."

CODE="$(date +%y%m%d%H)"
VER="$(grep -m1 versionName apps/mobile/android/app/build.gradle | sed -E 's/.*"([^"]+)".*/\1/')"
step "Building the Play bundle, version $VER ($CODE) (5–15 minutes)"
AAB=apps/mobile/android/app/build/outputs/bundle/release/app-release.aab
STAMP="$(mktemp)"
( cd apps/mobile/android && ./gradlew :app:bundleRelease --console=plain \
    -PyaysUploadProperties="$PROPS" -PyaysVersionCode="$CODE" ) || fail "The Android build failed (see the lines above)."
[ "$AAB" -nt "$STAMP" ] || fail "No new bundle was made."

OUT="../YaysApp-$VER-$CODE.aab"
cp "$AAB" "$OUT" || fail "Couldn't copy the bundle."
echo "AAB=$(cd .. && pwd)/YaysApp-$VER-$CODE.aab" >> "$LOG.steps"
echo "BUILD_OK $VER ($CODE)" >> "$LOG.steps"
step "Done: $OUT ($(du -h "$OUT" | cut -f1)). Upload it in Play Console › YaysApp › Test and release."
open -R "$OUT" 2>/dev/null
read -r -p "Press Enter to close." _
