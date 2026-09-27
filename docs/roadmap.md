# Roadmap

Working record of the full code review of 2026-09-27: nine reviewers over
every line of production code (frontend, Rust backend, e2e harness, CI,
translations), with the critical and high findings re-verified by hand
afterwards. Each bundle below becomes its own PR against `unstable`; this
file tracks what has landed.

Severity in brackets. `(verified)` marks the findings reproduced or confirmed
against the code by hand, not only reported.

## Bundle 1 — data safety

The paths where the application can lose or silently diverge somebody's
writing.

- [high] (verified) `mergeDocuments` never calls `seedWatchBaselines`, so a
  document opened through Ctrl+O, the recents or the OS has no watch
  baseline; typing inside the first three seconds of the watcher makes
  `classifyExternalChange` report a conflict against the user's own fresh
  keystrokes, and the dialog's Reload discards them.
- [high] (verified) the autosave arms at 2 s while the watcher's first tick
  is at 3 s: a session restored dirty over a file that changed while meditor
  was closed is autosaved over the external change before the watcher ever
  gets to classify it.
- [high] (verified) when the final session write fails, `requestQuit` alerts
  and returns without quitting — the application cannot be left. The masked
  queue errors also make every failure say "session".
- [high] (verified) Ctrl+S reaches `save()` with the ConflictDialog open
  (no guard in the handler, no propagation stop in the dialog): the buffer
  is written, and the dialog's later "Reload from disk" installs stale
  content over it.
- [high] (verified) the Editor's `idChanged` branch restores the cached
  per-tab state without comparing it to the `content` prop, so an external
  reload applied to a background tab is lost when the user switches back to
  it. Same root as the active-tab branch rebuilding the whole state on an
  external content change (undo history and caret position go with it).

## Bundle 2 — editor correctness

- [high] (verified) `syncCompartments` restores eight of nine compartments:
  `formattingCompartment` is missing, so after a tab switch Ctrl+B/I/K use
  the markers of the document that was open at mount (Markdown `**` in a
  Typst tab and vice versa).
- [high] (verified) `buildMarkdownPairKeymap` checks no syntax context and
  no document kind: `_`/`*`/`` ` ``/`~`/`$` auto-pair inside fenced and
  inline code (`snake_case` becomes `snake_case_`), in Typst (subscripts)
  and in LaTeX; and it dispatches on `selection.main` only, destroying
  multi-cursor selections.
- [medium] `fontThemeCache` is read but never written — the memoisation its
  comment describes does not exist and every font change leaks a mounted
  StyleModule.
- [medium] the Typst/LaTeX language imports have no `.catch`: a failed
  dynamic import leaves an unhandled rejection and the previous document's
  highlighting stuck.
- [medium] image paste/drop handlers ride React props on the wrapper div,
  so they run after CodeMirror's own: `preventDefault` arrives late and
  dropping an SVG inserts both the raw text and the link.
- [medium] `writeImage` crosses the IPC as `Array.from(bytes)` — a JSON
  array of millions of numbers for a screenshot.
- [low] `toggleTask` does not recognise `> - [ ] task` inside blockquotes;
  `Mod-g` binding does not declare `shift`; `wrap` sits unused in the
  content effect's deps; `suppress` is dead for `setState`; the zen
  selector overrides the user's font size.

## Bundle 3 — bundle and budget

- [high] (verified) Rollup packs the shared CJS interop helper inside the
  `pagedjs` manual chunk, so the entry statically imports it and 513 KB of
  paged.js ride the first load (entry `import{g}from"./pagedjs-…"`,
  `modulepreload` in dist/index.html). `NEVER_IN_THE_FIRST_LOAD` does not
  cover it.
- [high] (verified) the budget plugin sums `chunk.code.length` — UTF-16
  code units, not bytes. With the 104-language tables the real first load
  is ~2.41 MB against a 2.2 MB limit, and the build passes counting 2.13 M.
  Static CSS is not counted either.

## Bundle 4 — dialogs, a11y and RTL

- [high] dialog keyboard handling (Escape + focus trap) hangs off the
  overlay's React `onKeyDown`: once focus escapes the subtree (a click on
  the panel's padding focuses `body`), Escape no longer closes and the
  global handler fires `exitZen` instead. ConflictDialog's trap cycles two
  of its three buttons.
- [high] `.menu-panel { right: 0 }` and ~10 more physical properties with
  no `[dir="rtl"]` counterpart anywhere in the CSS: the main menu grows off
  the clipped viewport in the six RTL languages.
- [high] StatusBar is `role="status" aria-atomic="true"` around the caret
  readout: screen readers re-announce the whole bar on every arrow key.
- [medium] F1/F2 answer before any modal guard (dialogs stack over
  Preferences/About/presentation); the AltGr guard (`!e.altKey`) covers
  only f, the digits and the zoom keys, so AltGr+O/W/P fire on Spanish
  keyboards; contrast below AA in dark (`--accent-fg` 3.10:1), `--danger`
  undefined (fallback 3.07:1), LanguagePicker muted text 3.16:1;
  LanguagePicker `activeIndex` starts at 0 (an immediate Enter switches the
  UI to English); menu role/tab semantics; `vh` where `dvh` is needed.
- [low] ConfirmDialog ids are static while two instances can coexist;
  outline ignores indented ATX and setext headings; hardcoded "Ctrl+" in
  the overlay on macOS; assorted aria-label/role fixes.

## Bundle 5 — Typst

- [high] (verified) the whole Typst sync surface queries `[data-source-loc]`,
  an attribute the typst.ts WASM never emits (it emits `data-span`) and that
  `sanitizeSvg` strips anyway: scroll-to-line, reverse sync and the page
  count are dead code with no test coverage.
- [high] the worker registers the default package registry: a document with
  `#import "@preview/…"` makes it download and compile third-party code
  from the network, which the CSP does not cover and the comments deny.
- [medium] file mappings are marked held on `postMessage` although the WASM
  returns a bool nobody reads; no compile cancellation in the protocol (a
  stale queue delays the fresh result); a failed `beforeBuild` poisons the
  cached global compiler promise and Retry reuses the dead worker; compile
  errors surface as Rust `Debug` dumps instead of `unix` diagnostics mapped
  to editor lines.
- [low] `pageCount` counts `<svg` tags but typst.ts emits one SVG with
  `<g class="typst-page">` pages; LaTeX spinner sticks on an emptied
  document; duplicated log rendering on LaTeX failure; CSP keeps the dead
  SwiftLaTeX origins.

## Bundle 6 — translation content

- [high] (verified, pre-dates the September batches — `git blame` to the
  August i18n expansion) structural parity is perfect across the 104
  languages, but nothing checks content: word-by-word hybrids ("Документ is
  no longer доступно for сачувај", sr), a corrupt word ("Bukaing", id),
  `file.*`/`session.*` clusters untranslated or hybrid in ~39 languages,
  `preview.pages`="pages" in ~87, the nine plural functions still English
  in the four Amazigh languages, trailing-space loss in `*ErrorPrefix`
  keys. Plan: retranslate the affected clusters and add a content test
  (English-word runs in non-EN values) so parity means translation, not
  presence.

## Bundle 7 — e2e harness, CI and Rust hardening

- [high] (verified, the specs' own comments document past incidents)
  `freshPage` does not isolate the web session: the `pagehide` flush during
  its reload re-seeds localStorage after the second clear, so one spec's
  document survives into the next; the suite depends on alphabetical order
  and per-spec manual restores.
- [medium] `release.yml` `workflow_dispatch` has no tag guard (a branch run
  creates a release named after the branch) and interpolates
  `github.ref_name` straight into a script; `deploy-pages` cancels
  in-flight deployments; the CI smoke test accepts a silent exit 0 as
  "started"; `print_document` (Windows) blocks an async worker on `recv()`
  with no timeout; export fallbacks write the destination before
  validating the bytes; `capabilities` grant `dialog:default` that the
  frontend never uses and lack `core:window:allow-destroy` that App's last
  resort calls; sync I/O commands run on the main thread.
- [low] tauri-shim `open_files` returns null instead of []; unused npm deps
  (`plugin-dialog`, `@testing-library/jest-dom`); README promises Node 20
  while the harness needs 21+; `tsc --noEmit` skips vite.config.ts; dead
  template assets in `public/`; assorted spec cleanups without `.catch`;
  eleven specs never assert console health; recent-menu index race; macOS
  `alert` blocks the main thread; `image.rs` climb depth; remote images
  beacon on document open (preference to come); KaTeX without
  `maxSize`/`maxExpand`; "Rendering diagram…" untranslated; Mermaid errors
  re-render every keystroke; paged.js abandoned paginations keep running
  (`chunker.stop()` never called); theme memo misses OS scheme changes
  under `system`.

## Dismissed after verification

- Marp CSS `</style>` break-out (reported critical): reproduced against the
  installed marp-core with five payload variants — marpit strips `<` from
  every position (string, comment, `url()`). Not exploitable; the hygiene
  fix (build the `<style>` node instead of interpolating into `innerHTML`)
  travels with Bundle 5's preview work anyway.
