#!/bin/bash
# Sends YaysApp's iPhone app to TestFlight: builds a Release archive (production API, https://api.yaysapp.com),
# signs it for the App Store and uploads it to App Store Connect. Double-click it in Finder.
#
# Needs, once:
#   1. Xcode signed in with an Apple ID on the Indexx Apple Developer team (Xcode › Settings › Accounts).
#   2. An app in App Store Connect (appstoreconnect.apple.com › Apps › +) with bundle ID com.indexx.yaysapp.
# Each run gets a new build number (date and time), so it can be run again any time.
# Everything is also written to testflight.log next to this file.
cd "$(dirname "$0")"
ROOT="$PWD"
LOG="$ROOT/testflight.log"
: > "$LOG"; : > "$LOG.steps"
exec > >(tee -a "$LOG") 2>&1
step() { printf "\n\033[1;33m▶ %s\033[0m\n" "$1"; echo "STEP: $1" >> "$LOG.steps"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$1"; echo "FAILED: $1" >> "$LOG.steps"; echo; read -r -p "Press Enter to close." _; exit 1; }

# ---- tools ----
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
command -v node >/dev/null || fail "Node.js isn't installed."
command -v pnpm >/dev/null || npm install -g pnpm@10 || corepack enable pnpm
step "Tools"
xcodebuild -version 2>/dev/null | head -1 || fail "Xcode isn't installed (or not set up)."
case "$(xcode-select -p 2>/dev/null)" in *CommandLineTools*) fail "In Terminal: sudo xcode-select -s /Applications/Xcode.app — then run this again.";; esac

# ---- Apple Developer team ----
step "Apple Developer team"
TEAM_FILE="$ROOT/apps/mobile/ios/.team-id"
TEAM="$(cat "$TEAM_FILE" 2>/dev/null | tr -d '[:space:]')"
if [ -z "$TEAM" ]; then
  TEAMS="$( (defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null; defaults read com.apple.dt.Xcode IDEProvisioningTeams 2>/dev/null) | grep -oE 'teamID = "?[A-Z0-9]{10}' | grep -oE '[A-Z0-9]{10}$' | sort -u)"
  N="$(printf '%s\n' "$TEAMS" | grep -c .)"
  if [ "$N" = "1" ]; then TEAM="$TEAMS"
  else
    [ "$N" -gt 1 ] && { echo "Xcode is signed in to these teams:"; defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null | grep -E 'teamID|teamName' ; }
    [ "$N" = "0" ] && echo "Xcode doesn't seem to be signed in to an Apple Developer team (Xcode › Settings › Accounts)."
    echo "Your Team ID is on developer.apple.com › Account › Membership details (10 letters and numbers)."
    read -r -p "Team ID: " TEAM
  fi
fi
TEAM="$(echo "$TEAM" | tr -d '[:space:]')"
[[ "$TEAM" =~ ^[A-Z0-9]{10}$ ]] || fail "That isn't a Team ID (10 capital letters and numbers)."
echo "$TEAM" > "$TEAM_FILE"
echo "Team: $TEAM"

# ---- code ----
step "Installing packages"
pnpm install >/dev/null || fail "pnpm install failed."
pnpm --filter @yays/tokens build >/dev/null && pnpm --filter @yays/shared build >/dev/null || fail "Building the shared code failed."
echo "export NODE_BINARY=\"$(command -v node)\"" > apps/mobile/ios/.xcode.env.local

step "Installing the iOS libraries (CocoaPods)"
cd apps/mobile/ios
if command -v bundle >/dev/null && bundle install --quiet 2>/dev/null; then POD="bundle exec pod"; else POD="pod"; fi
$POD install || { $POD install --repo-update || fail "pod install failed (see above)."; }

# ---- archive ----
BUILD="$(date +%y%m%d%H%M)"
VERSION="$(grep -m1 'MARKETING_VERSION' YaysApp.xcodeproj/project.pbxproj | grep -oE '[0-9.]+')"
OUT="$ROOT/apps/mobile/ios/build/testflight"
ARCHIVE="$OUT/YaysApp-$VERSION-$BUILD.xcarchive"
mkdir -p "$OUT"
step "Building the Release archive, version $VERSION ($BUILD) (5–20 minutes)"
xcodebuild -workspace YaysApp.xcworkspace -scheme YaysApp -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
  CURRENT_PROJECT_VERSION="$BUILD" archive | tee "$OUT/archive.log" | grep -E 'error:|warning: .*sign|ARCHIVE (SUCCEEDED|FAILED)|Signing Identity|Provisioning Profile'
[ -d "$ARCHIVE" ] && grep -q 'ARCHIVE SUCCEEDED' "$OUT/archive.log" || { grep -E 'error:' "$OUT/archive.log" | head -20; fail "The archive failed (full log: apps/mobile/ios/build/testflight/archive.log)."; }
echo "ARCHIVE_OK" >> "$LOG.steps"

# ---- upload ----
step "Uploading to App Store Connect (TestFlight)"
cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST
xcodebuild -exportArchive -archivePath "$ARCHIVE" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" -allowProvisioningUpdates 2>&1 | tee "$OUT/upload.log" | grep -vE '^\s*$' | tail -25
if grep -qE 'EXPORT SUCCEEDED|Upload succeeded|Uploaded YaysApp' "$OUT/upload.log"; then
  echo "UPLOAD_OK $VERSION ($BUILD)" >> "$LOG.steps"
  printf "\n\033[1;32m✔ YaysApp %s (%s) is uploaded.\033[0m Apple processes it for 5–30 minutes; then it appears in App Store Connect › YaysApp › TestFlight.\n" "$VERSION" "$BUILD"
  read -r -p "Press Enter to close." _
else
  echo "UPLOAD_FAILED" >> "$LOG.steps"
  echo; echo "The upload didn't go through (see above). Opening the archive in Xcode's Organizer:"
  echo "select it › Distribute App › TestFlight & App Store › Distribute."
  open "$ARCHIVE"
  read -r -p "Press Enter to close." _
  exit 1
fi
