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

# ── Did the application id change since the last build? ──────────────
#
# The identifier decides the Java package, and two build scripts generate
# sources into it: wry's writes nine files, tauri's writes TauriActivity.kt.
# Only wry declares `rerun-if-env-changed` for the variable that carries the
# package, so after a rename cargo reruns wry and leaves tauri cached. The new
# package gets nine of the ten files, MainActivity is left extending a
# TauriActivity nobody wrote, and Kotlin fails with
#
#   Unresolved reference: TauriActivity
#
# which points nowhere near the cause. A `generated` directory sitting outside
# the current package is the tell; clearing it and the two crates' build
# scripts puts everything back in one step.
java_root="src-tauri/gen/android/app/src/main/java"
identifier="$(sed -n 's/.*"identifier"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
  src-tauri/tauri.conf.json | head -1)"
if [ -n "$identifier" ] && [ -d "$java_root" ]; then
  current="$java_root/$(echo "$identifier" | tr '.' '/')"
  stale="$(find "$java_root" -type d -name generated 2>/dev/null \
    | grep -v "^$current/" || true)"
  if [ -n "$stale" ]; then
    echo "android-build: the application id is now $identifier; clearing what the old one left behind"
    echo "$stale" | while read -r dir; do
      [ -n "$dir" ] && rm -rf "$dir"
    done
    case "$target" in
      aarch64) triple=aarch64-linux-android ;;
      armv7)   triple=armv7-linux-androideabi ;;
      i686)    triple=i686-linux-android ;;
      x86_64)  triple=x86_64-linux-android ;;
      *)       triple="" ;;
    esac
    if [ -n "$triple" ]; then
      cargo clean -p tauri -p wry --target "$triple" \
        --manifest-path src-tauri/Cargo.toml >/dev/null
    fi
  fi
fi

# An empty beforeBuildCommand turns the hook off: the bundle in dist/ is the
# one we want, and the configured `pnpm build` would run the Windows binaries.
cargo tauri android build \
  --debug \
  --apk \
  --target "$target" \
  --config '{"build":{"beforeBuildCommand":""}}' \
  "${extra[@]}"

# A failed build has already stopped the script by now — the CLI returns a
# non-zero status and `set -e` is on. This is about the output path: the APK
# lands under a flavour directory the CLI chooses, and if that ever moves, the
# useful thing is to say so rather than to print a path that is not there.
apk="$(find src-tauri/gen/android -name '*-debug.apk' 2>/dev/null | head -1)"
if [ -z "$apk" ]; then
  echo "android-build: the build succeeded but no APK was found under" >&2
  echo "               src-tauri/gen/android — has the output path changed?" >&2
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
