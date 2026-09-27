# Roadmap

Working record of the full code review of 2026-09-27: nine reviewers over
every line of production code (frontend, Rust backend, e2e harness, CI,
translations), with the critical and high findings re-verified by hand
afterwards. Each bundle below becomes its own PR against `unstable`; this
file tracks what has landed.

Severity in brackets. `(verified)` marks the findings reproduced or confirmed
against the code by hand, not only reported.

## Bundle 1 — data safety

**Status: landed (PR #200).** All five findings fixed, each pinned by a new
test (`Editor.restore.test.tsx`, and new cases in `App.externalchange`,
`App.autosave` and `App.closeguard`). The pre-existing test that pinned the
old "nothing stops a shortcut while the conflict is up" behaviour was
rewritten to hold the file lock with Ctrl+O instead of Ctrl+S, keeping its
real subject — "Save as…" must not dismiss the dialog it cannot honour.

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

**Status: landed (PR #201), except the two image-pipeline mediums, which
move to a follow-up because they reach into `useImagePaste` and the Rust
`write_image` command.** Landed: the formatting compartment (pairs now ride
with the toggles, per document kind, and `syncCompartments` restores the
lot), the pair context (code and math nodes decline; Typst loses the tilde,
LaTeX keeps only `$`; every cursor of a multi-selection is served through
`changeByRange`, and a wrap now stays selected like the Ctrl+B/I toggles),
the font-theme cache that never cached, the `.catch` on both language
imports (plain text plus a console line instead of a stuck previous
language), quoted task checkboxes, `Mod-g` with Shift, and zen mode no
longer overruling the writer's font size.

- [high] (verified) `syncCompartments` restores eight of nine compartments:
  `formattingCompartment` is missing, so after a tab switch Ctrl+B/I/K use
  the markers of the document that was open at mount (Markdown `**` in a
  Typst tab and vice versa). — **fixed**
- [high] (verified) `buildMarkdownPairKeymap` checks no syntax context and
  no document kind: `_`/`*`/`` ` ``/`~`/`$` auto-pair inside fenced and
  inline code (`snake_case` becomes `snake_case_`), in Typst (subscripts)
  and in LaTeX; and it dispatches on `selection.main` only, destroying
  multi-cursor selections. — **fixed**
- [medium] `fontThemeCache` is read but never written — the memoisation its
  comment describes does not exist and every font change leaks a mounted
  StyleModule. — **fixed**
- [medium] the Typst/LaTeX language imports have no `.catch`: a failed
  dynamic import leaves an unhandled rejection and the previous document's
  highlighting stuck. — **fixed**
- [medium] image paste/drop handlers ride React props on the wrapper div,
  so they run after CodeMirror's own: `preventDefault` arrives late and
  dropping an SVG inserts both the raw text and the link. — *follow-up*
- [medium] `writeImage` crosses the IPC as `Array.from(bytes)` — a JSON
  array of millions of numbers for a screenshot. — *follow-up (Rust)*
- [low] `toggleTask` does not recognise `> - [ ] task` inside blockquotes;
  `Mod-g` binding does not declare `shift`; `wrap` sits unused in the
  content effect's deps; `suppress` is dead for `setState`; the zen
  selector overrides the user's font size. — **fixed** (deps/`suppress`
  travelled with Bundle 1)

## Bundle 3 — bundle and budget

**Status: landed (PR #202).** The CJS interop helpers ride their own chunk
(`cjs-helpers`, 0.76 kB) instead of living inside pagedjs, so the first load
drops paged.js's 513 kB entirely (only `cjs-helpers` and `preload-helper`
are preloaded now); the budget counts real UTF-8 bytes and the statically
linked CSS, and `NEVER_IN_THE_FIRST_LOAD` now names pagedjs and mermaid too,
so the next shared helper that lands in a lazy chunk fails the build instead
of quietly riding the entry. The first load measures ≈1.94 MB against the
2.2 MB limit; it was ≈2.41 MB real while being counted as 2.13 M.

- [high] (verified) Rollup packs the shared CJS interop helper inside the
  `pagedjs` manual chunk, so the entry statically imports it and 513 KB of
  paged.js ride the first load (entry `import{g}from"./pagedjs-…"`,
  `modulepreload` in dist/index.html). `NEVER_IN_THE_FIRST_LOAD` does not
  cover it. — **fixed**
- [high] (verified) the budget plugin sums `chunk.code.length` — UTF-16
  code units, not bytes. With the 104-language tables the real first load
  is ~2.41 MB against a 2.2 MB limit, and the build passes counting 2.13 M.
  Static CSS is not counted either. — **fixed**

## Bundle 4 — dialogs, a11y and RTL

**Status: landed in two parts.** Part 1, the keyboard and the modals, was
PR #203: a shared `useDialogKeys` hook owns Escape and the Tab trap on the
*document* for all six dialogs, so they survive the focus escaping to the
body (a click on the panel's padding used to hand Escape to the global
handler, which read it as "exit zen"); the trap counts every enabled button
(ConflictDialog's third was outside it, RenameDialog's disabled confirm
leaked the focus out); F1/F2 no longer stack a dialog over an open one; one
global AltGr gate replaces the per-branch guards that only some letters
had; the update offer waits behind any other modal; the status bar stopped
being an `aria-atomic` live region re-read on every caret move. Part 2
(PR #204) is the visual and picker half: every asymmetric physical property
in the chrome and the document styles became logical (`inset-inline-end`,
`padding-inline-start`, `text-align: start` — the menu, the tabs, the
outline, the picker, the about close button, the present HUD, blockquotes,
lists, callouts, hanging indents, in the screen CSS *and* in paged.css, so
print follows the document's own direction too); each of the four themes
names its own `--danger` and the dark `--accent-fg` is a near-black that
clears 6:1 on the accent (white measured 3.1:1); the muted texts that
measured under AA are raised; the dialogs use `dvh`; the language picker
opens on the language in use (an immediate Enter no longer switches the
interface to English), filters on the trimmed query, keeps its "no results"
live region out of the listbox, and dismisses through an `onCancel` that
closes the picker instead of the whole menu; Tab in the menu closes it and
returns the focus to the toggle; the outline lists ATX headings indented up
to three spaces; the "+" button moved out of the `tablist` (into a
`display: contents` wrapper, layout untouched); the tab arrows mirror in
RTL and a double tap can rename on a phone (`touch-action: manipulation`);
the about dialog has a heading like its four siblings.

Still open from this bundle, deliberately:
- setext headings (`Title\n=====`) in the outline — recognising them needs
  real paragraph tracking to avoid calling every `---` after text a
  heading; the gap is noted rather than half-fixed.
- platform-aware modifier names in the shortcuts overlay ("Ctrl" is
  translated — German says "Strg" — so a find/replace to "⌘" on macOS
  cannot work; it needs a decision about how the overlay names keys).
- the presentation overlay: its key handler ignores modifiers, global
  shortcuts stay live during a slideshow, its `aria-modal` has no focus
  trap, and `startViewTransition().finished` can reject unhandled.
- `memo()` on Topbar/TabBar/StatusBar/Outline is inert while App passes
  fresh closures every render; a `useCallback` pass is its own change.

- [high] dialog keyboard handling (Escape + focus trap) hangs off the
  overlay's React `onKeyDown`: once focus escapes the subtree (a click on
  the panel's padding focuses `body`), Escape no longer closes and the
  global handler fires `exitZen` instead. ConflictDialog's trap cycles two
  of its three buttons. — **fixed (part 1)**
- [high] `.menu-panel { right: 0 }` and ~10 more physical properties with
  no `[dir="rtl"]` counterpart anywhere in the CSS: the main menu grows off
  the clipped viewport in the six RTL languages. — **fixed (part 2, without
  needing `[dir="rtl"]` rules at all: the properties are logical now)**
- [high] StatusBar is `role="status" aria-atomic="true"` around the caret
  readout: screen readers re-announce the whole bar on every arrow key. —
  **fixed (part 1)**
- [medium] F1/F2 answer before any modal guard (dialogs stack over
  Preferences/About/presentation); the AltGr guard (`!e.altKey`) covers
  only f, the digits and the zoom keys, so AltGr+O/W/P fire on Spanish
  keyboards. — **fixed (part 1)**
- [medium] contrast below AA in dark (`--accent-fg` 3.10:1), `--danger`
  undefined (fallback 3.07:1), LanguagePicker muted text 3.16:1;
  LanguagePicker `activeIndex` starts at 0 (an immediate Enter switches the
  UI to English); menu role/tab semantics; `vh` where `dvh` is needed. —
  **fixed (part 2; menu gets Tab-closes rather than roving tabindex, see
  the open notes above)**
- [low] ConfirmDialog ids are static while two instances can coexist —
  **fixed (part 1, `useId` + the offer waits behind other modals)**;
  outline ignores indented ATX and setext headings; hardcoded "Ctrl+" in
  the overlay on macOS; assorted aria-label/role fixes. — **fixed (part 2)
  except the setext headings and the macOS modifier names, which stay open
  with the notes above**

## Bundle 5 — Typst

**Status: landed (PR #205), except the CSP's dead SwiftLaTeX origins, which
travel with Bundle 7's configuration items.** Two review claims did not
survive contact with the toolchain and were corrected before fixing: the
compiler WASM emits *no* source locations at all (so `data-span`, the
suggested replacement for the dead `data-source-loc`, does not exist either
— it belongs to a renderer-side interactive viewer this build never uses),
and the page counter's fix is `g.typst-page`, verified against a real
compile of the sample (3 pages, one `<svg>`).

- [high] (verified) the whole Typst sync surface queries `[data-source-loc]`,
  an attribute the typst.ts WASM never emits and that `sanitizeSvg` strips
  anyway: scroll-to-line, reverse sync and the page count are dead code with
  no test coverage. — **fixed by removal**: the handle stays (so the outline
  and the preview treat every kind alike) as documented no-ops that say what
  the toolchain lacks, the click marking goes with them, and the page count
  is real (`g.typst-page`, with a test). Sync returns when typst.ts emits
  locations in its SVG pipeline.
- [high] the worker registers the default package registry: a document with
  `#import "@preview/…"` makes it download and compile third-party code
  from the network, which the CSP does not cover and the comments deny. —
  **fixed**: an offline registry is registered through
  `$typst.use(TypstSnippet.withPackageRegistry(…))`; the import becomes a
  compile error that says meditor compiles offline.
- [medium] file mappings are marked held on `postMessage` although the WASM
  returns a bool nobody reads — **fixed** (a failed request forgets the
  files it carried, so the retry sends them again); no compile cancellation
  in the protocol — **fixed** (an SVG request a newer one overtook answers
  `skipped` without touching the compiler; a PDF is never skipped); a failed
  `beforeBuild` poisons the cached global compiler promise and Retry reuses
  the dead worker — **fixed** (the first-ever failure of a worker is marked
  `fatal`; the page drops it, fails what was queued behind it, and the next
  request starts clean); compile errors surface as Rust `Debug` dumps —
  **fixed** (`humanizeTypstError` lifts the messages and hints out of the
  dump and passes through anything it does not recognise; the snippet API
  hard-codes `diagnostics: 'none'`, so 'unix' is not available).
- [low] `pageCount` counts `<svg` tags — **fixed**; LaTeX spinner sticks on
  an emptied document — **fixed**; duplicated log rendering on LaTeX
  failure — **fixed** (the error names the exit status; the log renders
  once); CSP keeps the dead SwiftLaTeX origins — *Bundle 7*; the failed
  engine `<script>` accumulating in `<head>` — **fixed**; `setRetryToken`
  shadowing the translation function — **fixed**; the dead `outputRef` —
  **gone** with the marking code; backslash paths on Windows — **fixed**
  (both `written` and `from` normalise, with tests); the first request's
  `fontBase` winning forever — **documented** (every request in a run comes
  from the same page).

## Bundle 6 — translation content

**Status: landed (PR #206).** An audit script compared every one of the 104
dictionaries against English and found 1 174 exact copies and 161
word-by-word hybrids ("Empty or invalid датотека path") across 88
languages — all retranslated (12 batches), including the Amazigh four's
plural functions, which the structural tests could not see, and the
`*ErrorPrefix` keys that had lost the space the alert concatenation needs.
What was reported as ~39 languages with English function bodies was
re-measured at 4 × 9 once the strings the September batches had already
translated were accounted for. `translations.test.ts` now carries three
content tests — no translatable value left in English (with a reviewed
allowlist of internationalisms and of the words that *are* the local word,
like "document" in Catalan), no English bigram fingerprints inside
translated values, and no English bodies in the Amazigh functions — so
parity now means translation, not presence.

- [high] (verified, pre-dates the September batches — `git blame` to the
  August i18n expansion) structural parity is perfect across the 104
  languages, but nothing checks content: word-by-word hybrids, a corrupt
  word ("Bukaing", id), whole clusters in English (~87 languages for
  `preview.pages`), the plural functions still English in the four Amazigh
  languages, trailing-space loss in `*ErrorPrefix` keys. — **fixed, with
  the content tests above as the ratchet**

## Bundle 7 — e2e harness, CI and Rust hardening

**Status: landed (PR #207).** The web session's debounced writer lost its
`isTauri()` gate on the way — the specs' dependence on the `freshPage` leak
and the silent web session loss turned out to be the same finding, and the
honest fix was to write the session in every backend, not to preserve a
stale seed for the tests to find.

- [high] (verified, the specs' own comments document past incidents)
  `freshPage` does not isolate the web session: the `pagehide` flush during
  its reload re-seeds localStorage after the second clear, so one spec's
  document survives into the next; the suite depends on alphabetical order
  and per-spec manual restores. — **fixed**: the reload carries a
  document-start `localStorage.clear()` init script, removed right after,
  and the debounced session writer now runs in the web build too (a browser
  crash used to take the whole session silently).
- [medium] `release.yml` `workflow_dispatch` has no tag guard (a branch run
  creates a release named after the branch) and interpolates
  `github.ref_name` straight into a script — **fixed** (`if:
  startsWith(github.ref, 'refs/tags/')` on the jobs, `$TAG` through env);
  `deploy-pages` cancels in-flight deployments — **fixed**
  (`cancel-in-progress: false`: queued runs still cancel, the one between
  upload and deploy no longer does); the CI smoke test accepts a silent
  exit 0 as "started" — **fixed** (124 is the only healthy outcome);
  `print_document` (Windows) blocks an async worker on `recv()` with no
  timeout — **fixed** (`spawn_blocking` + `recv_timeout(300s)`, and a
  disconnected channel is an error, not a silent success); `capabilities`
  grant `dialog:default` that the frontend never uses and lack
  `core:window:allow-destroy` that App's last resort calls — **fixed**
  (swapped); the base CSP names SwiftLaTeX's dead origins — **fixed** (the
  `latex-enabled.json` overlay carries them now, and
  `configOverlays.test` measures that the overlay is the base plus exactly
  those origins).
- [low] tauri-shim `open_files` returns null instead of [] — **fixed**;
  unused npm deps (`plugin-dialog`, `@testing-library/jest-dom`) —
  **removed**; README promises Node 20 while the harness needs the global
  `WebSocket` — **fixed** (`engines: node >=22`, README says why); dead
  template assets in `public/` — **removed**; assorted spec cleanups
  without `.catch` — **fixed** (images, recent-files, dialogs), plus
  preferences' cleanup moved to its `finally` and chrome-profile's Chrome
  stopped in one; KaTeX without `maxSize` — **fixed** (one hostile `\rule`
  no longer hangs the preview layout); abandoned paginations keep running —
  **fixed** (`chunker.stop()` before destroy, one try per part).

Deliberately deferred (each is its own change, none is a regression):
`tsc -b` so vite.config.ts is typechecked; console-health asserts in the
eleven specs that lack them; `reachableUrl` accepting any 200; the
latex-full spec's two 150 s legs against a 180 s runner timeout; the
export fallbacks that write the destination before validating the bytes
(needs the Windows/GTK engines in hand); async I/O commands off the main
thread; the recent-menu index race; the macOS `alert` blocking the main
thread; `image.rs` climb depth; remote images beaconing on document open
(wants a preference); "Rendering diagram…" untranslated (wants a key in
104 languages); Mermaid errors re-rendered per keystroke; the diagram theme
missing OS scheme changes under `system`; the presentation overlay's
keyboard isolation; the `memo`/`useCallback` performance pass.

## Dismissed after verification

- Marp CSS `</style>` break-out (reported critical): reproduced against the
  installed marp-core with five payload variants — marpit strips `<` from
  every position (string, comment, `url()`). Not exploitable; the hygiene
  fix (build the `<style>` node instead of interpolating into `innerHTML`)
  travels with Bundle 5's preview work anyway.
