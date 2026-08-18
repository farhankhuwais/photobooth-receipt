#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:-git@github.com:farhankhuwais/photobooth-receipt.git}"
DIR="${DIR:-/var/www/photobooth}"
BRANCH="${BRANCH:-main}"

echo "==> Deploy Photobooth ke $DIR"

if [ ! -d "$DIR/.git" ]; then
  sudo mkdir -p "$DIR"
  sudo chown -R "$USER" "$DIR"
  git clone --branch "$BRANCH" "$REPO" "$DIR"
fi

cd "$DIR"
git pull --ff-only

# Frontend
npm install
npm run build

# Backend bridge (opsional; butuh printer terpasang)
cd "$DIR/server"
npm install

echo "==> Selesai."
echo "Frontend: buka folder $DIR/dist (serve dengan nginx/pm2-static)."
echo "Bridge   : cd $DIR/server && PRINTER_PATH=/dev/ttyUSB0 PRINTER_BAUD=9600 npm start"
echo "          (Linux: PRINTER_PATH=/dev/ttyUSB0 atau device bluetooth; bukan COM3)"
