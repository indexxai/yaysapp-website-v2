#!/bin/bash
# YaysApp's backend on this Mac with Docker: MongoDB (a replica set) and Redis in containers, then the API on
# http://localhost:4000. Uses the ports in apps/api/.env (MongoDB 27018, Redis 6380). Opens Docker Desktop if needed.
# Double-click it in Finder. Close this window (or press Ctrl+C) to stop the API; the containers keep their data
# and stop with: docker stop yays-mongo yays-redis
cd "$(dirname "$0")"
LOG="$PWD/backend-run.log"
: > "$LOG"; : > "$LOG.steps"
exec > >(tee -a "$LOG") 2>&1
step() { printf "\n\033[1;33m▶ %s\033[0m\n" "$1"; echo "STEP: $1" >> "$LOG.steps"; }
fail() { printf "\n\033[1;31m✖ %s\033[0m\n" "$1"; echo "FAILED: $1" >> "$LOG.steps"; echo; read -r -p "Press Enter to close." _; exit 1; }

for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$b" ] && eval "$("$b" shellenv)"; done
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh" >/dev/null
export PATH="/usr/local/bin:/Applications/Docker.app/Contents/Resources/bin:$HOME/.orbstack/bin:$PATH"
command -v node >/dev/null || fail "Node.js isn't installed."
command -v pnpm >/dev/null || npm install -g pnpm@10 || corepack enable pnpm

# ---- Docker ----
step "Starting Docker"
command -v docker >/dev/null || fail "Docker isn't installed. Install Docker Desktop from docker.com (or OrbStack), then run this again."
echo "docker: $(command -v docker) · apps: $(ls /Applications 2>/dev/null | grep -iE 'docker|orbstack|rancher|podman' | tr '\n' ' ') · colima: $(command -v colima)"
if ! docker info >/dev/null 2>&1; then
  if [ -d /Applications/Docker.app ]; then open -a Docker
  elif [ -d /Applications/OrbStack.app ]; then open -a OrbStack
  elif command -v colima >/dev/null; then colima start
  fi
  for _ in $(seq 1 90); do docker info >/dev/null 2>&1 && break; sleep 2; done
  docker info >/dev/null 2>&1 || fail "Docker didn't start. Open Docker Desktop, wait until it says it's running, then run this again."
fi
docker version --format 'Docker {{.Server.Version}}'

# ---- MongoDB and Redis ----
MONGO_PORT=27018; REDIS_PORT=6380
run() { # name, then docker run arguments: reuse the container if it exists
  local name="$1"; shift
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then docker start "$name" >/dev/null; else docker run -d --name "$name" "$@" >/dev/null; fi
}
step "Starting MongoDB on port $MONGO_PORT"
run yays-mongo -p 127.0.0.1:$MONGO_PORT:$MONGO_PORT -v yays-mongo-data:/data/db mongo:7 \
  mongod --replSet rs0 --bind_ip_all --port $MONGO_PORT --setParameter diagnosticDataCollectionEnabled=false || fail "MongoDB didn't start."
step "Starting Redis on port $REDIS_PORT"
run yays-redis -p 127.0.0.1:$REDIS_PORT:6379 redis:7 || fail "Redis didn't start."
for _ in $(seq 1 60); do nc -z 127.0.0.1 $MONGO_PORT 2>/dev/null && break; sleep 1; done

[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env
step "Installing packages"
pnpm install >/dev/null || fail "pnpm install failed."
pnpm --filter @yays/tokens build >/dev/null && pnpm --filter @yays/shared build >/dev/null || fail "Building the shared code failed."
step "Setting up the MongoDB replica set"
node infra/rs-init.js "mongodb://127.0.0.1:$MONGO_PORT/?directConnection=true" || fail "The MongoDB replica set didn't start (see above)."

# ---- the API ----
if curl -sf -o /dev/null http://localhost:4000/v1/health; then
  echo "An API is already running on port 4000."; echo "RUNNING" >> "$LOG.steps"; read -r -p "Press Enter to close." _; exit 0
fi
step "Starting the API on http://localhost:4000"
pnpm --filter @yays/api dev > api-run.log 2>&1 &
API=$!
trap 'kill $API 2>/dev/null; exit 0' INT TERM HUP
for _ in $(seq 1 90); do curl -sf -o /dev/null http://localhost:4000/v1/health && break; kill -0 $API 2>/dev/null || break; sleep 2; done
curl -sf -o /dev/null http://localhost:4000/v1/health || { tail -30 api-run.log; fail "The API didn't start (see above, and api-run.log)."; }
echo "RUNNING" >> "$LOG.steps"
printf "\n\033[1;32m✔ The backend is running: http://localhost:4000 (the Android emulator reaches it at 10.0.2.2:4000)\033[0m\n"
echo "  Sign-in codes aren't sent in development. The last code for a number or email:"
echo "  http://localhost:4000/v1/_test/outbox?to=%2B923001234567"
echo "  API log: api-run.log. Keep this window open; close it or press Ctrl+C to stop the API."
wait $API
