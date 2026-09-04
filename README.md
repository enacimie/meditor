<p align="center">
  <img src="src-tauri/icons/icon.png" alt="meditor logo" width="128" />
</p>

# meditor

**Markdown/Typst/LaTeX editor for desktop and mobile** with live WASM preview, PDF export, and bidirectional editor↔preview sync. Built with [Tauri](https://tauri.app) (Rust) and React. Supports **104 languages** and 3 document formats.

**[Try it in the browser →](https://enacimie.github.io/meditor/)** — the same codebase as a static web build (Chromium recommended: open/save real files needs the File System Access API; elsewhere files go through upload/download).

![meditor screenshot](screenshots/screenshot1.png)

## Features

### Extended Markdown

- **GFM**: tables, task lists, strikethrough, and autolinks.
- **Extensions**: `==highlight==`, `++inserted++`, subscript `H~2~O`, superscript `E=mc^2^`, footnotes, definition lists, abbreviations, emoji 😊, and custom containers (`::: warning`, `::: note`).
- **Math** with [KaTeX](https://katex.org): inline `$e^{i\pi}+1=0$` and block `$$ ... $$`.
- **Diagrams** [Mermaid](https://mermaid.js.org) (flowchart, sequence, gantt, etc.), rendered as **vector SVG**.
- **Code highlighting** with [highlight.js](https://highlightjs.org).

### Editing

- [CodeMirror 6](https://codemirror.net) editor with Markdown and code block syntax highlighting.
- **Multi-document tabs**: create, close, rename (double-click or **F2**), and unsaved changes indicator. Navigate with **Ctrl+Tab** / **Ctrl+Shift+Tab**.
- **Per-tab independent state** (separate undo history and scroll position).
- **Typing aids**: automatic bracket/quote pair completion, smart backspace, auto-continue for lists and blockquotes.
- **Drag & drop or paste images** into the editor — they are inlined as markdown and previewed live.
- **Persistence**: open/save real files and **session restoration** (tabs and content) between launches.

### Interface

- **104 languages** with a searchable selector in the menu. Full RTL support (Arabic, Urdu, Persian, Pashto, Sindhi, Hebrew, etc.).
- **4 themes**: System, Light, Dark, and a **High Contrast** colorblind-friendly theme (WCAG AA everywhere).
- **Layout modes** (Ctrl+1/2/3): editor only, editor and preview, or preview only — reading a document without its source. The choice is remembered.
- **Touch**: on a touch screen the workspace is one pane at a time (splitting a phone in half helps nobody), controls grow to a 44px target, tapping the preview marks a spot without dragging you into the editor, and on-screen undo/redo appear — a touch keyboard has no Ctrl.
- **Zen mode** (F11): fullscreen distraction-free writing.
- **Keyboard shortcuts overlay** (F1) and in-window dialogs for confirm/rename (fully themed and localized).
- **Preferences** (Ctrl+,): editor font size and family, with a live sample, and the spell checker toggle. Wide tables that fit no portrait page can be allowed to claim a landscape one (off by default — a sideways page is opt-in, and the table says so on the sheet).
- **Spell checking** provided by the platform (Windows and macOS webviews; on Linux it also needs WebKitGTK's own setting), in the interface language.
- **Status bar** with word/line/character counts and unsaved indicator.
- **Outline** (table of contents) from headings for quick navigation.

### Preview & Sync

- Two preview modes:
  - **Web**: comfortable on-screen view.
  - **Document**: **paginated A4 pages** with [paged.js](https://pagedjs.org) and LaTeX aesthetics (**Latin Modern** font, justified text, *booktabs*-style tables, page numbers and a running title from the second page on).
- **Bidirectional sync** editor ↔ preview:
  - **Double-click** in preview → jumps to the corresponding line of code.
  - **"Go to preview"** and **"Go to code"** buttons in each panel.
  - Clicking in preview **marks** the position (blue outline) as a jump reference.
- **Resizable panels** by dragging the divider.

### Presentations (Marp)

A Markdown document that opens with `marp: true` front-matter becomes a slide
deck, rendered live with [Marp](https://marp.app). It is still an ordinary
`.md` file — the front-matter opts it in, and removing it turns it back into a
document.

- **Live slide preview**: every `---` on its own line starts a slide. The
  preview stacks them scaled to the pane and keeps editor ↔ preview sync at
  slide granularity.
- **The usual toolkit inside slides**: KaTeX math, highlighted code, and
  Mermaid diagrams — the same Mermaid the editor already uses, not a second
  renderer.
- **Present** (in the menu, for Marp documents): full-screen, one slide at a
  time. Arrow keys / Space / Page Down advance, Home / End jump, Esc returns to
  editing. Slides change through the View Transitions API, and elements marked
  as fragments reveal one step at a time before the deck moves on.
- **Slide transitions**: set a default with `transition:` in the front-matter
  (`fade`, `slide`, `wipe`, `zoom`, `none`, …) or per slide with a
  `<!-- transition: wipe 0.6s -->` comment on the slide it should apply to.
  meditor defaults to a visible fade; `transition: none` switches instantly.
- **Fragments** (elements that appear one step at a time): Marp marks the
  items of `*` (and `)`) lists as fragment steps, and they reveal one by one,
  exactly as Marp Bespoke paces them. Any other element can opt in with the
  `fragment` class, or a list/row's children with `fragment-list`. Only the
  presenter reveals them — the preview and exports show everything.
- **Export**: to HTML (a self-contained deck) and to PDF, one slide per page at
  the slide's own size — 16:9 or 4:3, read from the deck rather than assumed.

Themes and directives (`theme:`, `class:`, `paginate`, `<!-- fit -->`…) work as
documented upstream. meditor builds on Marp's lightweight core and reuses its
own KaTeX and highlight.js instead of Marp's optional bundles, so nothing is
duplicated.

### Export & Distribution

- **Export to PDF** vector (selectable text, vector KaTeX and Mermaid) via WebKitGTK printing, without system dialog. A4 format with 2.5 cm margins on Linux. Typst and LaTeX export use their WASM engines on supported desktop targets. Marp decks export one slide per page at the slide's own size.
- **Export to HTML**: a single self-contained file (styles embedded, Mermaid diagrams as inline SVG, KaTeX already expanded) that opens in any browser with no network access. Markdown documents and Marp decks.
- Packaged as **AppImage**, **deb**, and **rpm** via `tauri build`.

### File associations

Installers register meditor for `.md`/`.markdown` and `.typ`/`.typst` on all desktop platforms — NSIS associations on Windows, `CFBundleDocumentTypes` on macOS (files opened from Finder are queued until the UI is ready), and on Linux the deb/rpm ship a shared-mime-info entry declaring `text/x-typst`, which upstream does not provide yet. The previous handler is backed up and restored on uninstall. `.tex`/`.latex`/`.ltx` stay unregistered while LaTeX support is disabled; build with `LATEX_ENABLED=true` to include them.

## Tech Stack

| Layer            | Technology                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Desktop shell    | [Tauri v2](https://tauri.app) (Rust + WebKitGTK)                                                        |
| Frontend         | React 19 + TypeScript + Vite                                                                            |
| Editor           | CodeMirror 6                                                                                            |
| Markdown         | markdown-it + plugins (GFM, footnote, mark, sub/sup, ins, deflist, abbr, emoji, container, texmath, highlightjs) |
| Math             | KaTeX                                                                                                   |
| Diagrams         | Mermaid                                                                                                 |
| Presentations    | Marp (@marp-team/marp-core)                                                                             |
| Code             | highlight.js                                                                                            |
| Pagination       | paged.js                                                                                                |
| Typography       | Latin Modern (GUST)                                                                                     |
| Typst            | @myriaddreamin/typst.ts (WASM compiler + SVG renderer)                                                   |
| LaTeX            | SwiftLaTeX PdfTeXEngine (WASM, EPL-2.0 / GPL-2.0)                                                       |

## Prerequisites

- [Rust](https://rustup.rs) (cargo).
- [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io).
- **Linux** (Ubuntu/Debian): system dependencies for Tauri/WebKitGTK:

  ```bash
  sudo apt update && sudo apt install -y \
    libwebkit2gtk-4.1-dev build-essential curl wget file \
    libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

  (You can also run `./setup.sh`, which installs everything needed.)

## Development

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` starts Vite and the native window with hot reload.

For reproducible LaTeX compilation, start the local TeX Live Ondemand service
before launching the app:

```bash
docker compose -f docker-compose.texlive.yml up -d
cp .env.example .env.local
pnpm tauri dev
```

See [docs/texlive-ondemand.md](docs/texlive-ondemand.md) for endpoint checks
and shutdown instructions. Without this service, the bundled LaTeX WASM still
loads, but package resolution depends on the historical public endpoint.

> To test only the frontend in the browser: `pnpm dev`. The same codebase also
> ships as a **static web build** (`pnpm build` → `dist/`, serve anywhere):
> editing, Markdown/Typst previews, session persistence (localStorage) and
> PDF export via the browser print dialog work without a native runtime.
> File access uses the File System Access API where available (Chromium);
> other browsers fall back to open-by-upload and save-as-download, and the
> external-change watcher only covers documents opened with live handles.

### Running Tests

```bash
pnpm test:run          # Frontend unit tests (Vitest)
pnpm test:coverage     # Unit tests + V8 coverage report in coverage/
pnpm test:e2e          # E2E specs in real headless Chrome (see tests/e2e)
pnpm test:e2e:latex    # Opt-in: full LaTeX E2E (requires Docker TeX Live)
pnpm test:all          # Unit + E2E, one shot
pnpm verify            # Lint, typecheck, audit, tests, E2E, fmt, Clippy and Rust tests
cargo test -p meditor  # Backend tests (Rust) alone
```

The **pre-commit hook** (husky) runs `pnpm verify` on every commit — nothing broken lands. Skip it in an emergency with `HUSKY=0 git commit ...`.

E2E specs live in `tests/e2e/` and use a zero-dependency CDP driver (`cdp.mjs`) against a real headless Chrome: dialogs and the window close guard (with a faithful Tauri IPC shim), the high-contrast theme's WCAG ratios, and the keyboard shortcuts. CI additionally runs dependency auditing, lint, TypeScript, V8 coverage, Rust formatting and Clippy. The expensive full LaTeX + Docker verification is available as the manually triggered `LaTeX integration` GitHub Actions workflow, so ordinary pull requests do not download several GB of TeX Live.

## Build

```bash
pnpm tauri build
```

Produces (in `src-tauri/target/release/bundle/`):

- `appimage/meditor_<version>_amd64.AppImage`
- `deb/meditor_<version>_amd64.deb`
- `rpm/meditor-<version>-1.x86_64.rpm`

To run the AppImage on distros without FUSE: `./meditor_*.AppImage --appimage-extract-and-run` (or install `libfuse2`).

### Windows

> **Smart App Control blocks the downloaded installer.** The installers are not
> code signed, and Windows 11 refuses to run an unsigned executable that came
> from the internet. An installer you build yourself carries no mark of the web
> and runs normally. **Do not switch Smart App Control off to get around it** —
> on Windows 11 that cannot be undone without reinstalling.
>
> [docs/windows.md](docs/windows.md) has the full picture, the workarounds, and
> what signing would take.

### Android

meditor runs on Android: editing, the live preview, session restore, a layout
built for a finger rather than a mouse, and opening and saving real files
through the Storage Access Framework. PDF export works for Typst and LaTeX,
which compile in the frontend's WASM, but not for Markdown, which needs the
webview's native printing — that menu entry is hidden there rather than left to
fail. See [docs/android.md](docs/android.md) for the two limits worth knowing
about, how to build a debug APK, and where to download one from CI without a
local toolchain.

![meditor editor on Android](screenshots/android-editor.jpg)

![meditor reading view on Android](screenshots/android-preview.jpg)

```bash
source scripts/android-env.sh   # SDK, NDK, JDK, Rust targets, Tauri CLI
pnpm build                      # the frontend bundle
./scripts/android-build.sh      # the APK
```

### iOS

Unknown, and honestly so — nobody on the project has a Mac, an iPhone or an
Apple developer account, and the CLI's `ios` subcommand does not even exist off
macOS. The **iOS probe** workflow (Actions → Run workflow) generates the Xcode
project and attempts an unsigned simulator build, then reports how far it got.
See [docs/ios.md](docs/ios.md).

The app *should* run on Apple devices — the stack supports iOS — but
distributing to them requires Apple's paid, proprietary developer program, and
this project does not pay for proprietary developer licenses. iOS stays an
unsigned probe until someone with an Apple account carries it.

### Testing

Not every platform is tested by hand. [docs/testing.md](docs/testing.md) lists
who tests what, and which targets are still unreviewed (rpm, macOS, iOS…).

## Keyboard Shortcuts

| Shortcut        | Action          |
| --------------- | --------------- |
| `Ctrl+N`        | New document    |
| `Ctrl+O`        | Open file(s)    |
| `Ctrl+S`        | Save            |
| `Ctrl+Shift+S`  | Save as         |
| `Ctrl+E`        | Export to PDF   |
| `Ctrl+W`        | Close tab       |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | Next / previous tab |
| `Ctrl+F`        | Find            |
| `Ctrl+K`        | Focus the find field |
| `Ctrl+H`        | Find & replace  |
| `Ctrl+G`        | Go to line      |
| `Ctrl+,`        | Preferences     |
| `F1`            | Shortcuts overlay |
| `F2`            | Rename tab      |
| `Ctrl+1`        | Editor only     |
| `Ctrl+2`        | Editor and preview |
| `Ctrl+3`        | Preview only    |
| `F11`           | Zen mode        |

Press **F1** anytime for the full list. Also: **double-click** in preview to jump to code, and **drag the divider** to resize panels.

## Project Structure

```
meditor/
├── index.html
├── src/
│   ├── main.tsx              # React entry point
│   ├── App.tsx               # Global state, tabs, sync, and panels
│   ├── App.css               # Styles (screen and print)
│   ├── Editor.tsx            # CodeMirror 6 (per-tab state)
│   ├── Preview.tsx           # Render + mermaid + pagination (paged.js)
│   ├── markdown.ts           # markdown-it config + data-line
│   ├── paged.css             # Document view styles (A4)
│   ├── sample.ts             # Sample document
│   ├── session.ts            # Session serialization types/helpers
│   ├── documentUtils.ts      # Document kind detection/normalization
│   ├── sanitizeSvg.ts        # SVG allowlist sanitization
│   ├── types.ts              # Shared types
│   ├── ErrorBoundary.tsx     # React error boundary
│   ├── TypstPreview.tsx      # Typst WASM compiler + SVG preview
│   ├── LatexPreview.tsx      # SwiftLaTeX WASM compiler + PDF preview
│   ├── MarpPreview.tsx       # Marp slide preview + slide↔source sync
│   ├── marpEngine.ts         # Configured Marp converter (slides → HTML+CSS)
│   ├── marpDetect.ts         # `marp: true` front-matter detection
│   ├── marpSlides.ts         # Map slides to their source lines (sync)
│   ├── marpPresent.ts        # Parse `transition` presentation directives
│   ├── i18n/                 # Internationalization
│   │   ├── I18nProvider.tsx  # Language context, storage, browser detection
│   │   └── translations/     # en.ts + 102 more language files (parity-tested)
│   ├── hooks/                # useThemeEffect, useSplitDivider, useKeyboardShortcuts…
│   ├── components/           # Topbar, TabBar, dialogs, LanguagePicker, ShortcutsOverlay, PresentOverlay…
│   └── assets/fonts/         # Latin Modern fonts (GUST)
├── src-tauri/
│   ├── src/lib.rs            # Commands: read/save, session, and PDF export
│   ├── src/locale.rs         # Localized backend error messages
│   ├── tauri.conf.json
│   ├── capabilities/         # Permissions (dialog, opener)
│   ├── gen/android/          # Android project (generated once, then committed)
│   └── Cargo.toml
├── scripts/                  # android-env.sh, android-build.sh
├── docs/android.md           # Building and installing the Android app
├── docs/ios.md               # The iOS probe workflow
├── docs/testing.md           # Who tests which platform, and what is unreviewed
├── tests/e2e/                # CDP-driven E2E harness (cdp.mjs, run.mjs, specs)
└── setup.sh                  # Install system dependencies (Linux)
```

## Fonts

The **Latin Modern** fonts included in `src/assets/fonts/` are distributed under the [GUST Font License](src/assets/fonts/GUST-FONT-LICENSE.TXT) (free). See the accompanying license file.

## License

meditor is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0-or-later). See [LICENSE](LICENSE) for the full text.

The **Latin Modern** fonts are under the [GUST Font License](src/assets/fonts/GUST-FONT-LICENSE.TXT) (free).

**SwiftLaTeX** (PdfTeXEngine) is under EPL-2.0 / GPL-2.0 with Classpath exception.
