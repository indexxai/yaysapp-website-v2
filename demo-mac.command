#!/bin/bash
# Fills YaysApp on this Mac with demo data (Sara Ahmed, her chats, groups, communities and calls)
# and opens it signed in as Sara. Start the app first with start-mac.command and leave it running.
# Double-click again later: it just signs you back in. To start the demo over, run in Terminal:
#   cd "<this folder>" && pnpm demo --reset
cd "$(dirname "$0")"
for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
out=$(node infra/demo-seed.mjs "$@" 2>&1 | tee /dev/tty)
link=$(printf '%s' "$out" | grep -o 'http://localhost:3000/demo#[A-Za-z0-9_-]*' | tail -1)
[ -n "$link" ] && open "$link"
echo; read -r -p "Press Enter to close." _
