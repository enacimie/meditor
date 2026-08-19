# meditor on iOS

Short version: unknown, and deliberately so.

Tauri v2 targets iOS the same way it targets Android, and the Rust side is
already prepared for it — the plugins that do not exist on a phone are gated on
`not(any(target_os = "android", target_os = "ios"))`, and the touch layout keys
off `(pointer: coarse)` rather than anything Android-specific. What is missing
is not code, it is a Mac — and a decision we will not make.

## The Apple license

meditor should run on Apple devices: the stack supports iOS and the Rust side
is already gated for it, not written out. What stands between the code and a
distributable build is not technical — it is Apple's developer program.
Signing for a real device requires a paid, proprietary developer account, and
this project does not pay for proprietary developer licenses. So there is no
unsigned, freely installable path on iOS the way there is for Android, and iOS
stays an unsigned probe until someone with an Apple account wants to carry it.

## Why there is a workflow instead of a build

Nobody on this project has a Mac, an iPhone, or an Apple developer account. The
`ios` subcommand of the Tauri CLI is not even exposed off macOS — it fails with
"unrecognized subcommand" — so none of this can be tried locally, at any depth.

`.github/workflows/ios-probe.yml` is therefore an experiment rather than a
gate. Run it by hand from **Actions → iOS probe → Run workflow**. It:

1. generates the Xcode project (`tauri ios init`),
2. discovers the scheme rather than assuming its name,
3. builds for the **simulator** with code signing switched off,
4. attaches the `.app` bundle if one comes out, and the logs either way.

Every step continues on error, and the job ends by writing a table to the run
summary saying how far it got. One run answers the question; a failure leaves a
diagnosis rather than a red cross.

It is `workflow_dispatch` only, so it never blocks a pull request and costs
nothing until someone presses the button.

## What it cannot answer

**Whether it runs on a real iPhone.** A device build needs a development team
and a provisioning profile, which is an Apple account decision rather than a
technical one. The simulator build is the most that can be learned without
paying for anything.

**Whether opening and saving work.** iOS has its own document-picker model —
security-scoped URLs, with `start`/`stopAccessingSecurityScopedResource` around
every access. `tauri-plugin-fs` knows about it, but meditor's file layer has
only been reasoned about for Android's Storage Access Framework, not tested
against iOS's. Expect this to need work.

## Why `gen/apple` is not committed

`gen/android` is committed, so its manifest is reviewable in diffs and builds
are reproducible. The Xcode project is not, for the opposite reason: with
nobody here able to regenerate or maintain it, a checked-in copy would rot
silently until someone with an Apple account tried to use it. The probe
generates it fresh on every run.
