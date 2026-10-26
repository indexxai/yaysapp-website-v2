#!/usr/bin/env bash
cd "$(dirname "$0")"
MONGO_PORT="${MONGO_PORT:-27018}"; REDIS_PORT="${REDIS_PORT:-6380}"
pkill -f "mongod --replSet rs0 --bind_ip 127.0.0.1 --port $MONGO_PORT" || true
redis-cli -p "$REDIS_PORT" shutdown nosave 2>/dev/null || true
echo stopped
