# meditor on Android

Tauri v2 targets Android, so the same Rust backend and the same web frontend
run on a phone. This page covers building and installing a debug APK, and is
honest about what the app can and cannot do there yet.

## Status

| Area | On Android |
| --- | --- |
| Editing, live preview, Markdown / Typst / LaTeX rendering | works |
| Session restore (open tabs and their contents) | works |
| Opening and saving files | **broken** — see [Files](#files) |
| PDF export, printing | not available; the button reports it |
| Layout, touch targets, on-screen keyboard | **not adapted yet** |
| Release signing, Play Store | out of scope |

The last two rows are the next two pieces of work. What exists today is a build
that compiles, installs and runs, which is what everything else has to sit on.

## Building

### Prerequisites

- An Android SDK with **platform-tools, a platform, build-tools and an NDK**.
- **JDK 17** (`sudo apt install openjdk-17-jdk`).
- Rust, via [rustup](https://rustup.rs).

`scripts/android-env.sh` finds all of that, adds Rust's four Android targets and
installs a Tauri CLI if one is missing. Source it, do not run it — the exports
have to survive into your shell:

```bash
source scripts/android-env.sh
```

It prints what it settled on. If it cannot find an SDK, point `ANDROID_HOME` at
one and source it again.

### The build

```bash
pnpm build                 # the frontend bundle, into dist/
./scripts/android-build.sh # the APK
```

The script prints the path to the APK, and the equivalent Windows path when the
checkout is reached through `/mnt`. Copy it to the phone and open it, or install
over USB:

```bash
adb install -r <path to the apk>
```

Android will ask you to allow installing from this source. Debug APKs carry the
throwaway key Android ships for the purpose; that is enough to sideload and
nowhere near enough to publish.

Pass `--target armv7` (or `i686`, `x86_64`) to build for something other than
arm64. Arm64 is every phone made this decade; the others exist for old devices
and the emulator.

### Building from WSL against a Windows checkout

This is the setup on the maintainer's machine, and it has one sharp edge worth
naming. The checkout lives on Windows and WSL reaches it through `/mnt/c`, so
`node_modules` holds **Windows** binaries — Vite's, and `@tauri-apps/cli`'s.
Linux cannot execute them, and a second `pnpm install` on the Linux side would
overwrite them and break the Windows workflow instead.

So the two sides split the work:

```bash
# On Windows, where node_modules belongs:
pnpm build

# In WSL:
source scripts/android-env.sh
./scripts/android-build.sh
```

`android-build.sh` refuses to start if `dist/` is not there, and disables
Tauri's `beforeBuildCommand` so nothing tries to run the Windows bundler. The
Tauri CLI it uses comes from crates.io (`cargo install tauri-cli`), not from
`node_modules`, for the same reason.

CI has no such split — everything there is Linux — so the workflow uses the
ordinary `pnpm tauri android build`.

### Why a `cargo-tauri` is needed either way

Worth knowing before the error is met head-on. Gradle's `rust` plugin does not
build the library itself: it shells back out to `cargo tauri android
android-studio-script`, and the executable name is hardcoded in the generated
`buildSrc`. So `cargo-tauri` has to be on `PATH` even when the outer build is
driven by `pnpm tauri`, or the build dies mid-Gradle with

```
error: no such command: `tauri`
> Process 'command 'cargo'' finished with non-zero exit value 101
```

`scripts/android-env.sh` installs it. CI, which has only the npm CLI, puts a
one-line `cargo-tauri` on `PATH` that forwards to it rather than compiling a
second copy on every run.

### Without a local toolchain

Every CI run builds a debug APK and attaches it to the run as the
`meditor-android-debug-apk` artifact. Open the run under **Actions**, scroll to
Artifacts, download, unzip, install.

## Files

Opening and saving does not work yet, and it fails in a specific way worth
recording.

Android hands apps a `content://` URI from the Storage Access Framework, not a
filesystem path. `open_files`, `save_as`, `write_pdf_bytes` and `write_html_file`
all convert the picker's result with `FilePath::into_path()`, which rejects a
`content://` URI outright. The picker opens, you choose a file, and the
operation fails.

The fix is to read and write through the file descriptor the SAF gives, which
`tauri-plugin-fs` already knows how to resolve. That is the next piece of work
after the touch layout.

One consequence is already handled: sessions are stored whole — contents
included — in the app's private config directory, which behaves normally on
Android. Tabs survive a restart even though the link to the original file does
not.

## The application id

`tauri.conf.json` still carries the placeholder identifier `com.x.meditor`, and
on Android that string becomes the **application id**: the package name, the
JNI symbol names, and the Java source tree under `src-tauri/gen/android`.

Two things follow.

- Changing it means regenerating the Android project (`cargo tauri android
  init`), and it also moves the desktop app's config directory, orphaning
  existing users' sessions and preferences. It is a decision worth making
  deliberately rather than as a side effect.
- After a first publish to a store it cannot be changed at all.

Nothing is published, so there is still room to choose. Until someone does, the
placeholder stands.

## Regenerating the Android project

`src-tauri/gen/android` is committed, so an ordinary build never regenerates it.
If it has to be regenerated — a changed identifier, a Tauri upgrade that moves
the template on:

```bash
source scripts/android-env.sh
rm -rf src-tauri/gen/android
cargo tauri android init
```

Then re-apply anything hand-edited in there and check the diff carefully; the
manifest is where permissions and intent filters live.
