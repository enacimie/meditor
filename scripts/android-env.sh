#!/usr/bin/env bash
#
# Prepare a shell for building the Android app.
#
#   source scripts/android-env.sh
#
# Sourcing it exports ANDROID_HOME, NDK_HOME and JAVA_HOME, puts the SDK tools
# on PATH, and installs what is missing: Rust's four Android targets and a
# Tauri CLI that runs on this machine.
#
# Running it instead of sourcing it does the same work but the exports die with
# the subshell, so it only serves as a check.
#
# Everything is idempotent: on a prepared machine it is a handful of lookups
# and no installs.
#
# Note on Node. This deliberately does not want one. The repository is normally
# checked out on Windows and shared with WSL through /mnt/c, where node_modules
# holds Windows binaries — @tauri-apps/cli included — that Linux cannot run.
# Rather than install a second, conflicting dependency tree, the Android build
# uses a Linux `cargo tauri` and a frontend bundle built beforehand. See
# scripts/android-build.sh.

_android_env_die() {
  echo "android-env: $1" >&2
  return 1
}

_android_env_setup() {
  # ── The SDK ────────────────────────────────────────────────────────
  # A tree only counts if it carries an NDK: Rust cross-compiles through it,
  # and a machine can easily hold a second SDK (emulator images, say) that
  # would pass a naive "does platforms/ exist" test and then fail the build
  # much later with a confusing linker error.
  local candidates=("${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android"
                    "$HOME/Android/Sdk" "$HOME/android-sdk" "/usr/lib/android-sdk")
  local sdk="" dir
  for dir in "${candidates[@]}"; do
    [ -n "$dir" ] || continue
    if [ -d "$dir/platforms" ] && [ -d "$dir/ndk" ]; then
      sdk="$dir"
      break
    fi
  done
  [ -n "$sdk" ] || _android_env_die \
    "no Android SDK with an NDK found. Install one, or point ANDROID_HOME at it." || return 1

  # ── The NDK ────────────────────────────────────────────────────────
  # Highest version wins, compared as a version rather than as a string, so
  # that 28 does not sort below 9.
  local ndk
  ndk="$(ls -1 "$sdk/ndk" 2>/dev/null | sort -V | tail -1)"
  [ -n "$ndk" ] || _android_env_die "no NDK under $sdk/ndk" || return 1

  # ── The JDK ────────────────────────────────────────────────────────
  # Gradle wants JAVA_HOME, not merely a java on PATH.
  local java_bin java_home=""
  java_bin="$(command -v java 2>/dev/null || true)"
  if [ -n "$java_bin" ]; then
    java_home="$(dirname "$(dirname "$(readlink -f "$java_bin")")")"
  fi
  [ -n "$java_home" ] || _android_env_die \
    "no java on PATH. Install a JDK 17: sudo apt install openjdk-17-jdk" || return 1

  export ANDROID_HOME="$sdk"
  export ANDROID_SDK_ROOT="$sdk"
  export NDK_HOME="$sdk/ndk/$ndk"
  export JAVA_HOME="$java_home"

  local build_tools extra="$sdk/platform-tools:$sdk/cmdline-tools/latest/bin"
  build_tools="$(ls -1 "$sdk/build-tools" 2>/dev/null | sort -V | tail -1)"
  if [ -n "$build_tools" ]; then
    extra="$extra:$sdk/build-tools/$build_tools"
  fi
  case ":$PATH:" in
    *":$sdk/platform-tools:"*) ;;
    *) export PATH="$extra:$PATH" ;;
  esac

  # ── Rust ───────────────────────────────────────────────────────────
  local cargo_bin="${CARGO_HOME:-$HOME/.cargo}/bin"
  if [ -d "$cargo_bin" ]; then
    case ":$PATH:" in
      *":$cargo_bin:"*) ;;
      *) export PATH="$cargo_bin:$PATH" ;;
    esac
  fi
  command -v rustup >/dev/null 2>&1 || _android_env_die \
    "no rustup on PATH; install Rust first (https://rustup.rs)" || return 1

  # arm64 covers every phone made this decade; the other three keep 32-bit
  # devices and the x86 emulator buildable, which is what `tauri android
  # build` asks for unless told otherwise.
  local installed target missing=()
  installed="$(rustup target list --installed 2>/dev/null)"
  for target in aarch64-linux-android armv7-linux-androideabi \
                i686-linux-android x86_64-linux-android; do
    grep -qx "$target" <<<"$installed" || missing+=("$target")
  done
  if [ ${#missing[@]} -gt 0 ]; then
    echo "android-env: adding Rust targets: ${missing[*]}"
    rustup target add "${missing[@]}" || return 1
  fi

  # ── The Tauri CLI ──────────────────────────────────────────────────
  # From crates.io rather than npm, so it is a native binary for this
  # machine and owes nothing to the Windows-side node_modules.
  if ! command -v cargo-tauri >/dev/null 2>&1; then
    echo "android-env: installing the Tauri CLI (one-off, a few minutes)"
    cargo install tauri-cli --version "^2" --locked || return 1
  fi

  cat <<EOF
android-env: ready
  ANDROID_HOME  $ANDROID_HOME
  NDK_HOME      $NDK_HOME
  JAVA_HOME     $JAVA_HOME
  cargo tauri   $(cargo tauri --version 2>/dev/null || echo '?')
EOF
}

_android_env_setup
