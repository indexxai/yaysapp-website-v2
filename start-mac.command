#!/bin/bash
# YaysApp v2 on this Mac: installs what's missing (with Homebrew), then starts the database, Redis,
# the call server, the API and the web app, and opens http://localhost:3000.
# Double-click it in Finder. Close this window (or press Ctrl+C) to stop everything.
set -e
cd "$(dirname "$0")"
step() { printf "\n\033[1;33m▶ %s\033[0m\n" "$1"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$1"; echo; read -r -p "Press Enter to close." _; exit 1; }

# ---- tools ----
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
command -v brew >/dev/null || fail "Homebrew is needed first. Open Terminal and run:
  /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\"
then double-click start-mac.command again."

node_major() { node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/'; }
if [ -z "$(node_major)" ] || [ "$(node_major)" -lt 20 ]; then
  step "Installing Node.js 22"
  brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
fi
if ! command -v pnpm >/dev/null; then
  step "Installing pnpm"
  npm install -g pnpm@10 || corepack enable pnpm
fi
if ! command -v mongod >/dev/null; then
  step "Installing MongoDB"
  brew tap mongodb/brew && brew install mongodb-community
fi
command -v redis-server >/dev/null || { step "Installing Redis"; brew install redis; }
command -v livekit-server >/dev/null || { step "Installing LiveKit (for calls)"; brew install livekit; }

# ---- settings for local use (made once; edit them freely afterwards) ----
if [ ! -f apps/api/.env ]; then
  cp apps/api/.env.example apps/api/.env
  sed -i '' -e 's/^# LIVEKIT_URL=/LIVEKIT_URL=/' -e 's/^# LIVEKIT_API_KEY=/LIVEKIT_API_KEY=/' -e 's/^# LIVEKIT_API_SECRET=/LIVEKIT_API_SECRET=/' apps/api/.env
  sed -i '' "s/^JWT_SECRET=.*/JWT_SECRET=$(openssl rand -hex 32)/" apps/api/.env
fi
[ -f apps/web/.env.local ] || cp apps/web/.env.example apps/web/.env.local

# ---- install and build ----
step "Installing packages (the first time takes a few minutes)"
pnpm install
pnpm --filter @yays/tokens build
pnpm --filter @yays/shared build

# ---- start ----
step "Starting MongoDB and Redis"
pnpm infra:up

pids=()
stop() { echo; step "Stopping"; for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; pkill -f "livekit-server --dev" 2>/dev/null || true; exit 0; }
trap stop INT TERM HUP EXIT

if ! nc -z 127.0.0.1 7880 2>/dev/null; then
  step "Starting the call server"
  livekit-server --dev --bind 127.0.0.1 > infra/.data/livekit.log 2>&1 & pids+=($!)
fi
step "Starting the API on http://localhost:4000"
pnpm --filter @yays/api dev & pids+=($!)
step "Starting the web app on http://localhost:3000"
pnpm --filter @yays/web dev & pids+=($!)

for _ in $(seq 1 120); do curl -sf -o /dev/null http://localhost:4000/v1/health && curl -s -o /dev/null http://localhost:3000/sign-in && break; sleep 2; done
open http://localhost:3000/sign-in
printf "\n\033[1;32m✔ YaysApp is running at http://localhost:3000\033[0m\n"
echo "  Sign-in codes aren't sent in development. Get the last code for a number or email here:"
echo "  http://localhost:4000/v1/_test/outbox?to=%2B923001234567  (your number, with %2B for the +, or your email)"
echo "  Keep this window open. Close it or press Ctrl+C to stop."
wait
