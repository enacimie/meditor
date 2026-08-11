#!/usr/bin/env bash
set -e

# Install system dependencies for Tauri v2 + WebKitGTK on Linux.
# See README.md for details.

sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  build-essential \
  curl \
  wget \
  file \
  libsoup-3.0-dev \
  libjavascriptcoregtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev \
  libssl-dev

echo ""
echo "Dependencies installed. Next: pnpm install && pnpm tauri dev"
