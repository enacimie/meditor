import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorView, basicSetup } from "codemirror";
import { EditorState, type Extension } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";

export type EditorHandle = {
  scrollToLine: (line: number) => void;
  getCursorLine: () => number;
};

type Props = {
  activeId: string;
  ids: string[];
  content: string;
  onChange: (content: string) => void;
};

const Editor = forwardRef<EditorHandle, Props>(function Editor(
  { activeId, ids, content, onChange },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const extRef = useRef<Extension[]>([]);
  const activeIdRef = useRef(activeId);
  const suppress = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
  }));

  useEffect(() => {
    if (!host.current) return;
    const extensions: Extension[] = [
      basicSetup,
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !suppress.current) {
          onChangeRef.current(u.state.doc.toString());
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
      }),
    ];
    extRef.current = extensions;
    const state = EditorState.create({ doc: content, extensions });
    states.current.set(activeId, state);
    activeIdRef.current = activeId;
    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      states.current.clear();
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || activeId === activeIdRef.current) return;
    states.current.set(activeIdRef.current, view.state);
    let next = states.current.get(activeId);
    if (!next) {
      next = EditorState.create({ doc: content, extensions: extRef.current });
      states.current.set(activeId, next);
    }
    suppress.current = true;
    view.setState(next);
    suppress.current = false;
    activeIdRef.current = activeId;
  }, [activeId, content]);

  useEffect(() => {
    const alive = new Set(ids);
    for (const key of Array.from(states.current.keys())) {
      if (!alive.has(key)) states.current.delete(key);
    }
  }, [ids]);

  return <div ref={host} className="editor-host" />;
});

export default Editor;
