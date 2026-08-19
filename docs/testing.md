# Testing

meditor ships for five platforms, but only some of them are tested by hand on
real devices. This page says who tests what and — more importantly — what is
still unreviewed, so a new tester knows exactly where they are needed.

## Who tests what

| Person | Platforms |
| --- | --- |
| [enacimie](https://github.com/enacimie) | Ubuntu (deb + AppImage), Android |
| [andresnacimiento](https://github.com/andresnacimiento) | Windows, Android |

## Test matrix

| Platform | Package | Tested by | Status |
| --- | --- | --- | --- |
| Ubuntu | deb | enacimie | Tested |
| Ubuntu | AppImage | enacimie | Tested |
| Windows | NSIS / MSI | andresnacimiento | Tested |
| Android | APK | enacimie, andresnacimiento | Tested |
| Fedora / openSUSE | rpm | — | Unreviewed |
| Other GNU/Linux distros (Arch, Debian derivatives…) | AppImage / from source | — | Unreviewed |
| macOS | app / dmg | — | Unreviewed |
| iOS | app | — | Unreviewed (probe only) |

## Unreviewed

- **rpm** — built on every release (`bundle.targets` is `"all"`) but never run
  on Fedora or openSUSE. The highest-value gap: a `.deb` that installs does not
  prove the `.rpm` does.
- **Other GNU/Linux distros** — the AppImage should work broadly, but nobody
  has confirmed it beyond Ubuntu.
- **macOS** — nobody on the project has a Mac. The bundle is produced but never
  launched, and the native print/PDF path is known to differ there (see
  `docs/android.md` for the PDF split).
- **iOS** — only the manual probe workflow exists (see `docs/ios.md`); running
  on a real device also needs an Apple developer account.

## How to help

Pick an unreviewed row, build the bundle for that platform (see the
[README](../README.md#build)), run it, and report what works and what does not.
Update the table above when you do.
