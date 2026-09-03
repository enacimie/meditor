### Windows: Smart App Control will block this installer

The installers are not code signed, and Windows 11 refuses to run an
unsigned executable that came from the internet. Nothing is wrong
with the download.

**Do not switch Smart App Control off to get around it** — on
Windows 11 that cannot be undone without reinstalling. Build the
installer yourself instead (`pnpm tauri build --bundles nsis`); one
you built carries no mark of the web and installs normally.

[docs/windows.md](https://github.com/enacimie/meditor/blob/main/docs/windows.md)
explains the whole thing, including what signing would take.

### Android

`meditor_<version>_arm64-debug.apk` is a debug build signed with
Android's throwaway key — enough to sideload, nowhere near enough to
publish.
