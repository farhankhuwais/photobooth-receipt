#!/usr/bin/env bash
set -e
DIR="$HOME/photobooth"
PORT=5173
cd "$DIR"
git fetch origin main -q
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "$(date) no change"
  exit 0
fi
echo "$(date) update: $LOCAL -> $REMOTE"
git pull --ff-only
npm install
npm run build
cd "$DIR/server" && npm install
pkill -f "vite preview" || true
sleep 1
cd "$DIR"
setsid npm run preview -- --host 0.0.0.0 --port "$PORT" >/tmp/preview.log 2>&1 < /dev/null &
echo "$(date) deployed"
