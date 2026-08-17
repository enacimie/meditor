import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import { placeholder, keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";
import {
  Compartment,
  EditorState,
  Prec,
  type Extension,
} from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { StreamLanguage } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap, openSearchPanel, gotoLine } from "@codemirror/search";
import {
  buildMarkdownPairKeymap,
  buildAutoContinueKeymap,
  buildSmartBackspaceKeymap,
} from "./editorKeymaps";
import { useImagePaste } from "./hooks/useImagePaste";
import type { DocKind } from "./types";
import "./Editor.css";

// Lazy-load the LaTeX language mode (legacy StreamLanguage, MIT licensed).
let latexLangPromise: Promise<Extension> | null = null;
function getLatexLang(): Promise<Extension> {
  if (!latexLangPromise) {
    latexLangPromise = import("@codemirror/legacy-modes/mode/stex")
      .then((stexMod) => StreamLanguage.define(stexMod.stex))
      .catch((e) => {
        latexLangPromise = null; // allow retry
        throw e;
      });
  }
  return latexLangPromise;
}

// Lazy-load the Typst language mode so the WASM/Lezer binary doesn't block
// the initial render or break E2E tests (which only use markdown docs).
// Resets on failure so the user can retry after a transient error.
let typstLangPromise: Promise<Extension> | null = null;
function getTypstLang(): Promise<Extension> {
  if (!typstLangPromise) {
    typstLangPromise = import("codemirror-lang-typst")
      .then((m) => m.typst_lezer())
      .catch((e) => {
        typstLangPromise = null; // allow retry
        throw e;
      });
  }
  return typstLangPromise;
}

/** Synchronous placeholder — the Compartment will be reconfigured async. */
function loadTypstLang(): Extension {
  getTypstLang(); // kick off the dynamic import
  return [];
}

function applyTypstLang(
  view: EditorView,
  compartment: Compartment,
  seq: number,
  seqRef: { current: number },
  appliedRef: { current: Extension },
) {
  getTypstLang().then((ext) => {
    if (view.viewport && seqRef.current === seq) {
      appliedRef.current = ext;
      view.dispatch({ effects: compartment.reconfigure(ext) });
    }
  });
}

/** Synchronous placeholder for LaTeX — the Compartment will be reconfigured async. */
function loadLatexLang(): Extension {
  getLatexLang(); // kick off the dynamic import
  return [];
}

function applyLatexLang(
  view: EditorView,
  compartment: Compartment,
  seq: number,
  seqRef: { current: number },
  appliedRef: { current: Extension },
) {
  getLatexLang().then((ext) => {
    if (view.viewport && seqRef.current === seq) {
      appliedRef.current = ext;
      view.dispatch({ effects: compartment.reconfigure(ext) });
    }
  });
}

export type EditorHandle = {
  scrollToLine: (line: number) => void;
  getCursorLine: () => number;
  /** Open (or focus) the find panel — wired to the Ctrl+K shortcut. */
  focusSearch: () => void;
};

type Props = {
  activeId: string;
  ids: string[];
  content: string;
  onChange: (content: string) => void;
  wrap: boolean;
  zenMode?: boolean;
  zenPlaceholder?: string;
  /** Fired when the cursor moves (or the active doc changes). 0-based line. */
  onCursorLineChange?: (line: number) => void;
  /** Document language ("markdown" or "typst"). */
  kind: DocKind;
};

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { activeId, ids, content, onChange, wrap, zenMode, zenPlaceholder, onCursorLineChange, kind },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const extRef = useRef<Extension[]>([]);
  const wrapCompartment = useRef(new Compartment());
  const placeholderCompartment = useRef(new Compartment());
  const languageCompartment = useRef(new Compartment());
  const kindSeqRef = useRef(0);
  const activeIdRef = useRef(activeId);
  const suppress = useRef(false);
  const onChangeRef = useRef(onChange);
  const onCursorLineChangeRef = useRef(onCursorLineChange);
  const lastIdsRef = useRef<string[]>([]);
  // Capture initial prop values for the mount-once effect
  const initialActiveId = useRef(activeId);
  const initialContent = useRef(content);
  const initialWrap = useRef(wrap);
  const initialZenMode = useRef(zenMode);
  const initialZenPlaceholder = useRef(zenPlaceholder);
  const initialKind = useRef(kind);
  // Language extension currently applied. view.setState() resets every
  // compartment to its mount-time value, so restoring the language needs the
  // resolved extension — for Typst/LaTeX it arrives asynchronously.
  const languageExtRef = useRef<Extension>(
    initialKind.current === "typst" || initialKind.current === "latex"
      ? []
      : markdown({ base: markdownLanguage, codeLanguages: languages }),
  );

  // Current values of the props that drive compartments, so the restore below
  // always uses what the user has now, not what a stale closure captured.
  const wrapRef = useRef(wrap);
  wrapRef.current = wrap;
  const zenModeRef = useRef(zenMode);
  zenModeRef.current = zenMode;
  const zenPlaceholderRef = useRef(zenPlaceholder);
  zenPlaceholderRef.current = zenPlaceholder;

  /**
   * Re-apply every prop-driven compartment.
   *
   * `view.setState()` swaps the whole configuration, which resets each
   * compartment to the value it was given at mount time. Any compartment that
   * depends on a prop therefore has to be restored right after — otherwise the
   * setting silently reverts when the user switches tabs.
   *
   * ADDING A COMPARTMENT? Add it here too.
   */
  const syncCompartments = useCallback((view: EditorView) => {
    view.dispatch({
      effects: [
        wrapCompartment.current.reconfigure(
          wrapRef.current ? EditorView.lineWrapping : [],
        ),
        placeholderCompartment.current.reconfigure(
          zenModeRef.current && zenPlaceholderRef.current
            ? placeholder(zenPlaceholderRef.current)
            : [],
        ),
        languageCompartment.current.reconfigure(languageExtRef.current),
      ],
    });
  }, []);

  // Image drag-and-drop + clipboard paste
  const { dragOver, busy, handleDragOver, handleDragEnter, handleDragLeave, handleDrop, handlePaste } =
    useImagePaste({ viewRef });

  useLayoutEffect(() => {
    onChangeRef.current = onChange;
    onCursorLineChangeRef.current = onCursorLineChange;
  }, [onChange, onCursorLineChange]);

  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      const n = Math.max(1, Math.min(line + 1, doc.lines));
      const info = doc.line(n);
      view.dispatch({
        selection: { anchor: info.from },
        effects: EditorView.scrollIntoView(info.from, { y: "center" }),
      });
      view.focus();
    },
    getCursorLine() {
      const view = viewRef.current;
      if (!view) return 0;
      return view.state.doc.lineAt(view.state.selection.main.head).number - 1;
    },
    focusSearch() {
      const view = viewRef.current;
      if (!view) return;
      openSearchPanel(view);
      // The search extension renders the panel synchronously but focuses the
      // field on a rAF, which is unreliable under test. Focus it directly so
      // Ctrl+K deterministically lands the cursor in the find input.
      const field = view.dom.querySelector<HTMLInputElement>(".cm-textfield");
      field?.focus();
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const isTypst = initialKind.current === "typst";
    const isLatex = initialKind.current === "latex";
    const extensions: Extension[] = [
      basicSetup,
      languageCompartment.current.of(
        isTypst
          ? loadTypstLang()
          : isLatex
            ? loadLatexLang()
            : markdown({ base: markdownLanguage, codeLanguages: languages }),
      ),
      search({ top: true }),
      // Highest precedence on purpose: basicSetup already pulls in
      // searchKeymap, which binds Mod-g to "find next", and array order alone
      // does not beat it. The shortcuts overlay and the README both document
      // Ctrl+G as "go to line" (CodeMirror's own binding is Ctrl+Alt+G) and
      // Ctrl+H as find & replace, which is the same panel plus its replace row.
      Prec.highest(
        keymap.of([
          { key: "Mod-h", run: openSearchPanel, preventDefault: true },
          { key: "Mod-g", run: gotoLine, preventDefault: true },
        ]),
      ),
      keymap.of(searchKeymap),
      buildMarkdownPairKeymap(),
      buildSmartBackspaceKeymap(),
      buildAutoContinueKeymap(),
      wrapCompartment.current.of(initialWrap.current ? EditorView.lineWrapping : []),
      placeholderCompartment.current.of(
        initialZenMode.current && initialZenPlaceholder.current ? placeholder(initialZenPlaceholder.current) : [],
      ),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !suppress.current) {
          onChangeRef.current(u.state.doc.toString());
        }
        // Report cursor movement so the outline can highlight the active heading.
        if (u.selectionSet || u.docChanged) {
          const line =
            u.state.doc.lineAt(u.state.selection.main.head).number - 1;
          onCursorLineChangeRef.current?.(line);
        }
      }),
      EditorView.theme({
        "&": {
          height: "100%",
          backgroundColor: "var(--bg)",
          color: "var(--fg)",
          fontSize: "14px",
        },
        ".cm-scroller": {
          overflow: "auto",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        },
        ".cm-gutters": {
          backgroundColor: "var(--bg-alt)",
          color: "var(--fg)",
          border: "none",
        },
        ".cm-content": { padding: "12px 0", caretColor: "var(--fg)" },
        ".cm-activeLineGutter": { backgroundColor: "transparent" },
        ".cm-foldGutter .cm-gutterElement": {
          padding: "0 4px",
          cursor: "pointer",
          color: "var(--fg)",
          opacity: 0.5,
        },
        ".cm-foldPlaceholder": {
          backgroundColor: "var(--bg-alt)",
          color: "var(--fg)",
          opacity: 0.6,
          border: "none",
          padding: "0 8px",
          margin: "2px 0",
        },
        ".cm-searchMatch": {
          backgroundColor: "color-mix(in srgb, var(--accent) 35%, transparent)",
          color: "inherit",
        },
        ".cm-searchMatch-selected": {
          backgroundColor: "color-mix(in srgb, var(--accent) 55%, transparent)",
          color: "inherit",
        },
      }),
    ];
    extRef.current = extensions;
    const state = EditorState.create({ doc: initialContent.current, extensions });
    states.current.set(initialActiveId.current, state);
    activeIdRef.current = initialActiveId.current;
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    // Report the initial cursor line so the outline highlights on first render.
    onCursorLineChangeRef.current?.(
      view.state.doc.lineAt(view.state.selection.main.head).number - 1,
    );
    const currentStates = states.current;
    return () => {
      view.destroy();
      viewRef.current = null;
      currentStates.clear();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
        effects: wrapCompartment.current.reconfigure(
          wrap ? EditorView.lineWrapping : [],
        ),
      });
  }, [wrap]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const isTypst = kind === "typst";
    const isLatex = kind === "latex";
    // Increment sequence so in-flight async lang loads don't overwrite
    // a newer kind after a quick tab switch or language toggle.
    kindSeqRef.current++;
    const seq = kindSeqRef.current;
    if (isTypst) {
      applyTypstLang(view, languageCompartment.current, seq, kindSeqRef, languageExtRef);
    } else if (isLatex) {
      applyLatexLang(view, languageCompartment.current, seq, kindSeqRef, languageExtRef);
    } else {
      const ext = markdown({ base: markdownLanguage, codeLanguages: languages });
      languageExtRef.current = ext;
      view.dispatch({ effects: languageCompartment.current.reconfigure(ext) });
    }
  }, [kind]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartment.current.reconfigure(
        zenMode && zenPlaceholder ? placeholder(zenPlaceholder) : [],
      ),
    });
  }, [zenMode, zenPlaceholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const idChanged = activeId !== activeIdRef.current;
    // This effect runs on every keystroke, and doc.toString() rebuilds the
    // whole document from CodeMirror's rope. Comparing lengths first (O(1))
    // skips that allocation for the common case: the editor already holds the
    // text React is handing back.
    if (
      !idChanged &&
      content.length === view.state.doc.length &&
      content === view.state.doc.toString()
    ) {
      return;
    }
    if (idChanged) {
      states.current.set(activeIdRef.current, view.state);
      let next = states.current.get(activeId);
      if (!next) {
        next = EditorState.create({ doc: content, extensions: extRef.current });
        states.current.set(activeId, next);
      }
      activeIdRef.current = activeId;
    } else {
      const next = EditorState.create({ doc: content, extensions: extRef.current });
      states.current.set(activeId, next);
    }
    suppress.current = true;
    view.setState(states.current.get(activeId)!);
    syncCompartments(view);
    states.current.set(activeId, view.state);
    suppress.current = false;
    // Report the cursor position of the newly active document.
    onCursorLineChangeRef.current?.(
      view.state.doc.lineAt(view.state.selection.main.head).number - 1,
    );
  }, [activeId, content, wrap, syncCompartments]);

  useEffect(() => {
    const prev = lastIdsRef.current;
    const same =
      prev.length === ids.length && prev.every((id, i) => id === ids[i]);
    if (same) return;
    lastIdsRef.current = ids;
    const alive = new Set(ids);
    for (const key of Array.from(states.current.keys())) {
      if (!alive.has(key)) states.current.delete(key);
    }
  }, [ids]);

  return (
    <div
      ref={host}
      className={`editor-host${dragOver ? " editor-drag-over" : ""}${busy ? " editor-busy" : ""}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={handlePaste}
    />
  );
});

export default Editor;
