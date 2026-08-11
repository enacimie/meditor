import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { placeholder, keymap } from "@codemirror/view";
import { EditorView, basicSetup } from "codemirror";
import {
  Compartment,
  EditorState,
  type Extension,
} from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import {
  buildMarkdownPairKeymap,
  buildAutoContinueKeymap,
  buildSmartBackspaceKeymap,
} from "./editorKeymaps";
import { useImagePaste } from "./hooks/useImagePaste";
import "./Editor.css";

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
};

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { activeId, ids, content, onChange, wrap, zenMode, zenPlaceholder, onCursorLineChange },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const extRef = useRef<Extension[]>([]);
  const wrapCompartment = useRef(new Compartment());
  const placeholderCompartment = useRef(new Compartment());
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
    const extensions: Extension[] = [
      basicSetup,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      search({ top: true }),
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
    if (!idChanged && content === view.state.doc.toString()) return;
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
    view.dispatch({
      effects: wrapCompartment.current.reconfigure(
        wrap ? EditorView.lineWrapping : [],
      ),
    });
    states.current.set(activeId, view.state);
    suppress.current = false;
    // Report the cursor position of the newly active document.
    onCursorLineChangeRef.current?.(
      view.state.doc.lineAt(view.state.selection.main.head).number - 1,
    );
  }, [activeId, content, wrap]);

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
