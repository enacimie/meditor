# Distributing meditor

Where meditor stands for each distribution channel, what each one demands, and
the concrete path to get there. This branch (`dist`) carries the packaging
artifacts referenced below.

## Current surface

| Channel            | State today                                        | Owner of the gate            |
| ------------------ | -------------------------------------------------- | ---------------------------- |
| GitHub Releases    | shipped: deb, rpm, AppImage, msi/exe, dmg, apk     | us                           |
| F-Droid            | not submitted; recipe drafted in `fdroid/`         | F-Droid team                 |
| Debian (official)  | packaging drafted in `debian/`; needs a sponsor    | a Debian Developer           |
| Ubuntu             | syncs from Debian; PPA is the self-service route   | us (PPA) / Debian (official) |
| AppImage gallery   | AppImage built; metainfo added in `packaging/`     | AppImageHub maintainers      |

Licensing is the one gate we already pass everywhere: the code is
`AGPL-3.0-or-later` and the bundled Latin Modern fonts are under the GUST Font
License — both DFSG-free and accepted by F-Droid, Debian and the AppImage
gallery. No proprietary asset ships in the repository.

## F-Droid

F-Droid builds every app from source on its own servers and signs it with its
own key. Requirements and how we meet them:

- **Free license.** AGPL-3.0-or-later. OK.
- **Buildable from source, no prebuilt binaries in git.** The repo contains no
  binaries; the Typst WASM and the frontend come from npm/cargo at build time.
  The Android project (`src-tauri/gen/android`) is committed and reviewable. OK.
- **A reproducible build recipe.** Drafted in `fdroid/com.enacimie.meditor.yml`.
- **Declared network use and permissions.** The manifest asks only for
  `INTERNET`. Core editing works offline; the only runtime download is the
  optional LaTeX compiler (TeX Live) from `https://texlive2.swiftlatex.com`.
  This must stay visible in the description; if F-Droid reads the third-party
  compile service as non-free it would be an `AntiFeatures: NonFreeNet` line,
  which we would accept rather than hide.

The hard part is that a Tauri Android build is not a plain gradle build: the
gradle step shells out to `cargo tauri`, so the build server needs a Rust
toolchain with the Android targets **and** a compiled `tauri-cli`, plus
node/pnpm for the frontend bundle. The recipe's `init` installs rustup, the
four Android targets, pnpm and `tauri-cli`. This is the least-charted area of
F-Droid packaging, so expect to iterate with the F-Droid team (their forum /
`fdroiddata` merge request) until the server build is green.

Submission order: open the merge request against `fdroiddata` with the metadata
and fastlane files (see `fastlane/`), then iterate on build failures.

## Debian (and Ubuntu)

Official Debian is a social process as much as a technical one: a package only
enters the archive when a Debian Developer uploads it. Our job is to make that
adoption cheap.

What this branch provides:

- `debian/` — a working source-package skeleton (control, rules, copyright,
  changelog, a concrete `.desktop`, and the metainfo install). It builds a
  usable `.deb` on a normal machine with system cargo/node.
- `packaging/com.enacimie.meditor.metainfo.xml` — the AppStream metainfo Debian
  requires for GUI packages.
- DFSG-clean licensing (above).

What a Debian maintainer will still do, and why we cannot do it here:

- Repackage the several hundred Rust crate dependencies with `debcargo` so the
  build uses only Debian sources (the Rust packaging team's workflow).
- Apply the JavaScript policy to the npm dependencies (bundle-from-source or
  packaged JS libs).
- Run the package through `lintian` and the NEW queue.

The realistic sequence:

1. Keep `debian/` building locally (this branch).
2. Publish a PPA on Launchpad for Ubuntu users today — a PPA is self-service
   and uses the same `debian/` directory; this is the honest "official-ish"
   Ubuntu channel we control.
3. File an RFS (Request for Sponsorship) on `debian-devel` with the packaging
   and a pointer to the PPA; a DD adopts it and drives the dependency
   packaging. Ubuntu then receives it through the normal Debian sync.

Treat official Debian/Ubuntu as a months-long sponsorship, not a release task.

## AppImage

The AppImage itself is already produced by the release workflow. "Official"
presence means the community gallery and, optionally, self-update:

- **AppImageHub gallery** (`appimage.github.io`): submit a pull request with a
  screenshot and the download URL. The gallery reads the AppStream metainfo,
  which is why `packaging/com.enacimie.meditor.metainfo.xml` exists and should
  also be placed inside the AppDir (`usr/share/metainfo/`).
- **AppImageUpdate (self-update)**: embed update information (`zsync`) at
  build time via `--updateinformation` so released AppImages can update
  themselves. Optional; adds a release artifact (`*.AppImage.zsync`).

## What lives in this branch

- `fdroid/com.enacimie.meditor.yml` — F-Droid recipe draft.
- `fastlane/metadata/android/en-US/` — title, descriptions, screenshots.
- `debian/` — Debian source-package skeleton.
- `packaging/com.enacimie.meditor.metainfo.xml` — AppStream metainfo.
