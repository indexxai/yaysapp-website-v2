#!/bin/bash
# YaysApp's iPhone app on this Mac: installs the iOS libraries (CocoaPods), builds the app, opens an iPhone simulator,
# starts Metro and launches the app. The API is not started here (backend-docker-mac.command does that).
# Double-click it in Finder. Close this window (or press Ctrl+C) to stop Metro.
# Everything is also written to ios-run.log next to this file.
cd "$(dirname "$0")"
ROOT="$PWD"
LOG="$ROOT/ios-run.log"
: > "$LOG"; : > "$LOG.steps"
exec > >(tee -a "$LOG") 2>&1
step() { printf "\n\033[1;33m▶ %s\033[0m\n" "$1"; echo "STEP: $1" >> "$LOG.steps"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$1"; echo "FAILED: $1" >> "$LOG.steps"; echo; read -r -p "Press Enter to close." _; exit 1; }

# ---- tools ----
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8   # CocoaPods needs UTF-8
command -v node >/dev/null || fail "Node.js isn't installed."
command -v pnpm >/dev/null || npm install -g pnpm@10 || corepack enable pnpm
step "Tools"
xcodebuild -version 2>/dev/null | head -1 || fail "Xcode isn't installed (or not set up). Install Xcode from the App Store, open it once, then run this again."
DEV="$(xcode-select -p 2>/dev/null)"; echo "Xcode at $DEV"
case "$DEV" in *CommandLineTools*) fail "Xcode is installed but the command-line tools point elsewhere. In Terminal: sudo xcode-select -s /Applications/Xcode.app — then run this again.";; esac
echo "node $(node -v) · pnpm $(pnpm -v) · ruby $(ruby -v | cut -d' ' -f2)"

step "Installing packages"
pnpm install >/dev/null || fail "pnpm install failed."
pnpm --filter @yays/tokens build >/dev/null && pnpm --filter @yays/shared build >/dev/null || fail "Building the shared code failed."

# Xcode's build steps don't see Terminal's PATH: tell them where Node is.
echo "export NODE_BINARY=\"$(command -v node)\"" > apps/mobile/ios/.xcode.env.local

# ---- CocoaPods ----
step "Installing the iOS libraries (CocoaPods; the first time takes a few minutes)"
cd apps/mobile/ios
if command -v bundle >/dev/null && bundle install --quiet 2>/dev/null; then POD="bundle exec pod"
elif command -v pod >/dev/null; then POD="pod"
else
  command -v brew >/dev/null || fail "CocoaPods isn't installed and Homebrew isn't either."
  brew install cocoapods || fail "Installing CocoaPods failed."
  POD="pod"
fi
echo "Using: $POD"
$POD install || { $POD install --repo-update || fail "pod install failed (see above)."; }
cd "$ROOT"

# ---- a simulator ----
step "Opening an iPhone simulator"
UDID="$(xcrun simctl list devices booted 2>/dev/null | grep -m1 -E 'iPhone' | grep -oE '[0-9A-F-]{36}')"
if [ -z "$UDID" ]; then
  UDID="$(xcrun simctl list devices available 2>/dev/null | grep -E '^\s+iPhone 1[5-9]|^\s+iPhone' | grep -v unavailable | tail -1 | grep -oE '[0-9A-F-]{36}')"
  [ -n "$UDID" ] || fail "There's no iPhone simulator. In Xcode: Settings › Components (or Platforms) › install iOS, then run this again."
  xcrun simctl boot "$UDID" 2>/dev/null || true
fi
open -a Simulator --args -CurrentDeviceUDID "$UDID"
xcrun simctl list devices | grep "$UDID"
echo "SIMULATOR=$UDID" >> "$LOG.steps"

# ---- Metro ----
if ! curl -s --max-time 3 http://localhost:8081/status | grep -q packager-status:running; then
  step "Starting Metro (serves the app's code)"
  ( cd apps/mobile && pnpm start > "$ROOT/metro-run.log" 2>&1 ) &
  METRO=$!
  trap 'kill $METRO 2>/dev/null; exit 0' INT TERM HUP
fi

# ---- build, install, open ----
# Signed "to run locally" (no Apple team needed): the keychain, where sign-in is kept, needs a signed app.
step "Building the iPhone app (the first time takes 5–15 minutes)"
cd apps/mobile/ios
xcodebuild -workspace YaysApp.xcworkspace -scheme YaysApp -configuration Debug -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath build CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= -quiet \
  || fail "The iPhone build failed (see the lines above)."
APP="$(find build/Build/Products/Debug-iphonesimulator -maxdepth 1 -name '*.app' | head -1)"
cd "$ROOT"
echo "BUILD_OK" >> "$LOG.steps"
step "Installing and opening YaysApp"
xcrun simctl install "$UDID" "apps/mobile/ios/$APP" || fail "Installing the app on the simulator failed."
xcrun simctl launch "$UDID" com.indexx.yaysapp || fail "Opening the app failed."
echo "RUNNING" >> "$LOG.steps"
printf "\n\033[1;32m✔ YaysApp is running on the iPhone simulator\033[0m\n"
echo "  The simulator reaches the API at localhost:4000 (start it with backend-docker-mac.command)."
echo "  Keep this window open; close it or press Ctrl+C to stop Metro."
[ -n "$METRO" ] && wait $METRO
read -r -p "Press Enter to close." _
