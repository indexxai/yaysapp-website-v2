#!/usr/bin/env bash
# Starts a local MongoDB replica set (transactions + change streams) and Redis for
# development and tests. Data lives in infra/.data and is safe to delete.
set -euo pipefail
cd "$(dirname "$0")"
MONGOD_BIN="${MONGOD_BIN:-$(command -v mongod || true)}"
REDIS_BIN="${REDIS_BIN:-$(command -v redis-server || true)}"
MONGO_PORT="${MONGO_PORT:-27018}"
REDIS_PORT="${REDIS_PORT:-6380}"
if [ -z "$MONGOD_BIN" ]; then echo "mongod not found. Install MongoDB 7+ or set MONGOD_BIN." >&2; exit 1; fi
if [ -z "$REDIS_BIN" ]; then echo "redis-server not found. Install Redis 7+ or set REDIS_BIN." >&2; exit 1; fi
mkdir -p .data/mongo .data/redis
if ! nc -z 127.0.0.1 "$MONGO_PORT" 2>/dev/null; then
  "$MONGOD_BIN" --replSet rs0 --bind_ip 127.0.0.1 --port "$MONGO_PORT" --dbpath .data/mongo \
    --fork --logpath .data/mongo.log --setParameter diagnosticDataCollectionEnabled=false >/dev/null
fi
if ! nc -z 127.0.0.1 "$REDIS_PORT" 2>/dev/null; then
  "$REDIS_BIN" --port "$REDIS_PORT" --dir .data/redis --daemonize yes --save "" --appendonly no >/dev/null
fi
node rs-init.js "mongodb://127.0.0.1:$MONGO_PORT/?directConnection=true"
echo "MongoDB replica set on $MONGO_PORT, Redis on $REDIS_PORT"
