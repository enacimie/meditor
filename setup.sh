#!/usr/bin/env bash
set -e

sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  libayatana-appindicator3-dev \
  libxdo-dev

echo ""
echo "Dependencias instaladas. Ahora ejecuta: pnpm tauri dev"
