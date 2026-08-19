#!/usr/bin/env bash
#
# Build a debug APK.
#
#   ./scripts/android-build.sh [--target aarch64] [-- <extra cargo-tauri args>]
#
# Debug APKs are signed with the throwaway debug key Android ships, which is
# enough to sideload one onto a phone and nowhere near enough to publish. A
# release build needs a keystore that is not this project's to create; see
# docs/android.md.
#
# The frontend bundle is expected to be there already, in dist/. That is not
# laziness: on the usual setup here the checkout lives on Windows and is
# reached through /mnt/c, so node_modules holds Windows binaries that Linux
# cannot execute. Building the bundle on the side that owns node_modules and
# handing Tauri the finished dist/ keeps one dependency tree instead of two.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
cd "$root"

target="aarch64"
extra=()
while [ $# -gt 0 ]; do
  case "$1" in
    --target) target="$2"; shift 2 ;;
    --) shift; extra=("$@"); break ;;
    *) extra+=("$1"); shift ;;
  esac
done

# shellcheck source=scripts/android-env.sh
source "$here/android-env.sh"

if [ ! -f "dist/index.html" ]; then
  cat >&2 <<'EOF'
android-build: dist/ is missing or incomplete.

Build the frontend first, on the machine that owns node_modules:

    pnpm build

then run this script again.
EOF
  exit 1
fi

if [ ! -d "src-tauri/gen/android" ]; then
  echo "android-build: no Android project yet, generating it"
  cargo tauri android init
fi

# An empty beforeBuildCommand turns the hook off: the bundle in dist/ is the
# one we want, and the configured `pnpm build` would run the Windows binaries.
cargo tauri android build \
  --debug \
  --apk \
  --target "$target" \
  --config '{"build":{"beforeBuildCommand":""}}' \
  "${extra[@]}"

apk="$(find src-tauri/gen/android -name '*-debug.apk' -newermt '-10 minutes' 2>/dev/null | head -1)"
if [ -z "$apk" ]; then
  echo "android-build: the build reported success but no fresh APK was found" >&2
  exit 1
fi

echo
echo "android-build: APK at"
echo "  $root/$apk"
case "$root" in
  /mnt/[a-z]/*)
    # Same file seen from Windows, so it can be copied to a phone from there.
    win="$(sed -E 's#^/mnt/([a-z])/#\U\1:/#' <<<"$root/$apk")"
    echo "  $win"
    ;;
esac
echo
echo "To install over USB (device visible to this shell, debugging enabled):"
echo "  adb install -r '$root/$apk'"
