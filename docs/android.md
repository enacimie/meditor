# meditor on Android

Tauri v2 targets Android, so the same Rust backend and the same web frontend
run on a phone. This page covers building and installing a debug APK, and is
honest about what the app can and cannot do there yet.

## Status

| Area | On Android |
| --- | --- |
| Editing, live preview, Markdown / Typst / LaTeX rendering | works |
| Session restore (open tabs and their contents) | works |
| Opening and saving files | works, with one limit — see [Files](#files) |
| Layout, touch targets, on-screen keyboard | adapted |
| PDF export of Typst and LaTeX | works (compiled in the frontend's WASM) |
| PDF export of Markdown, printing | not available; the menu entry is hidden |
| Release signing, Play Store | out of scope |

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

Android hands apps a `content://` URI from the Storage Access Framework rather
than a filesystem path. That is not a path in any useful sense: there is no
parent directory to write a temporary file into, nothing to rename, nothing to
canonicalise. Everything is read and written through the file descriptor the
framework hands over, which `tauri-plugin-fs` resolves.

Two consequences are worth knowing about.

**Saving is not atomic.** On a desktop meditor writes to a temporary file
beside the target and renames it over the top, so an interrupted save leaves
the original intact. The framework grants a descriptor for one document and
nothing else — no sibling to write beside, no directory entry to swap — so on
Android the file is written in place. An interrupted save can leave it
truncated. This is a real difference in durability, not a stylistic one.

**A reopened file forgets where it came from.** The picker grants access for
the life of the process (the dialog plugin uses `ACTION_GET_CONTENT`, which
carries no persistable permission), so after a restart the stored URI is a
string the app is no longer allowed to open. The document itself comes back
intact — sessions store contents whole, in the app's private directory, which
behaves normally — but its link to the original file does not, and the next
save goes through "save as". Fixing that properly needs `ACTION_OPEN_DOCUMENT`
and `takePersistableUriPermission`, which is a change to the dialog plugin
upstream rather than to this app.

## PDF export

Split, because the two routes are not the same thing.

**Typst and LaTeX** are compiled to PDF by the frontend's own WASM engines and
the bytes handed to Rust to write. That works anywhere the file dialog does,
Android included.

**Markdown** goes through the webview's native printing, which exists on Linux
and Windows only. On Android the menu entry is hidden rather than left to raise
an error — the interface asks Rust which platform it is on (`platform`) rather
than guessing from the user agent, which on Android says "Linux".

## The application id

The identifier is `com.enacimie.meditor`, and on Android that string becomes
the **application id**: the package name, the JNI symbol names, and the Java
source tree under `src-tauri/gen/android`.

Two things follow.

- Changing it means regenerating the Android project (`cargo tauri android
  init`), and it also moves the desktop app's config directory, orphaning
  existing users' sessions and preferences. It is a decision worth making
  deliberately rather than as a side effect.
- After a first publish to a store it cannot be changed at all.

Nothing is published yet, and `com.enacimie.meditor` is now the chosen id, so
this is settled as long as it happens before the first store publish.

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
