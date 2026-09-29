import { lazy, Suspense, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { EditorHandle } from "../Editor";
import type { EditorPreferences } from "../editorPreferences";
import type { DocumentLanguage } from "../documentLanguage";
import type { LineRange } from "../editorSelection";
import type { NoticeAPI } from "../hooks/useNotice";
import type { Language, TranslationFn } from "../i18n/translations";
import type { Doc } from "../types";
import Outline from "./Outline";
import type { Heading } from "./outlineUtils";

const Editor = lazy(() => import("../Editor"));

type Props = {
  t: TranslationFn;
  /** The pane's share of the workspace, as a CSS `flex` value. */
  flex: string;
  markdownSyncAvailable: boolean;
  handleForwardSync: () => void;
  coarsePointer: boolean;
  editorRef: RefObject<EditorHandle | null>;
  wrap: boolean;
  setWrap: Dispatch<SetStateAction<boolean>>;
  outlineOpen: boolean;
  setOutlineOpen: Dispatch<SetStateAction<boolean>>;
  headings: Heading[];
  cursorLine: number;
  activeId: string;
  ids: string[];
  active: Doc | undefined;
  updateContent: (content: string) => void;
  editorPrefs: EditorPreferences;
  zenMode: boolean;
  lang: Language;
  docLanguage: DocumentLanguage | null;
  onCursorMoved: (line: number, column: number) => void;
  onSelectionLines: (lines: LineRange | null) => void;
  showNotice: NoticeAPI["showNotice"];
};

/**
 * The editor's side of the workspace: its header of buttons, the outline, and
 * the editor itself, which loads on demand.
 *
 * It keeps no state: App decides everything it shows and hands it down.
 */
export default function EditorPane({
  t,
  flex,
  markdownSyncAvailable,
  handleForwardSync,
  coarsePointer,
  editorRef,
  wrap,
  setWrap,
  outlineOpen,
  setOutlineOpen,
  headings,
  cursorLine,
  activeId,
  ids,
  active,
  updateContent,
  editorPrefs,
  zenMode,
  lang,
  docLanguage,
  onCursorMoved,
  onSelectionLines,
  showNotice,
}: Props) {
  return (
    <div
      className="pane"
      style={{ flex }}
    >
      <div className="pane-header">
        <span className="pane-title">{t("pane.editor")}</span>
        {/* Shown whenever the editor is, like its counterpart in the
            other pane: from an editor-only layout it brings the preview
            back and scrolls there. */}
        {markdownSyncAvailable && (
          <button
            type="button"
            className="sync-btn"
            onClick={handleForwardSync}
            aria-label={t("pane.scrollToPreview")}
            title={t("pane.scrollToPreview")}
          >
            <svg aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m13 6 6 6-6 6" />
            </svg>
            {t("pane.goToPreview")}
          </button>
        )}
        {/* Only where they are the only way. A touch keyboard has no Ctrl,
            so without these there is no undo at all; on a desktop Ctrl+Z
            is right there and two more buttons would just be clutter. */}
        {coarsePointer && (
          <>
            <button
              type="button"
              className="sync-btn history-btn"
              onClick={() => editorRef.current?.undo()}
              aria-label={t("editor.undo")}
              title={t("editor.undo")}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7v6h6" />
                <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
              </svg>
            </button>
            <button
              type="button"
              className="sync-btn history-btn"
              onClick={() => editorRef.current?.redo()}
              aria-label={t("editor.redo")}
              title={t("editor.redo")}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 7v6h-6" />
                <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7" />
              </svg>
            </button>
          </>
        )}
        <button
          type="button"
          className={wrap ? "sync-btn on" : "sync-btn"}
          aria-pressed={wrap}
          aria-label={wrap ? t("pane.wrapOn") : t("pane.wrapOff")}
          onClick={() => setWrap((w) => !w)}
          title={t("pane.wrapTitle")}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12H3" />
            <path d="M21 6H3" />
            <path d="M21 18H3" />
          </svg>
        </button>
        <button
          type="button"
          className={outlineOpen ? "sync-btn on" : "sync-btn"}
          aria-expanded={outlineOpen}
          aria-controls="document-outline"
          aria-label={t("outline.toggle")}
          title={t("outline.toggle")}
          onClick={() => setOutlineOpen((v) => !v)}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 6h13" />
            <path d="M8 12h13" />
            <path d="M8 18h13" />
            <path d="M3 6h.01" />
            <path d="M3 12h.01" />
            <path d="M3 18h.01" />
          </svg>
        </button>
      </div>
      <div id="document-outline" hidden={!outlineOpen}>
        {outlineOpen && (
          <Outline
            t={t}
            headings={headings}
            cursorLine={cursorLine}
            onGoToLine={(line) => editorRef.current?.scrollToLine(line)}
          />
        )}
      </div>
      <Suspense fallback={<div className="editor-loading" role="status">{t("editor.loading")}</div>}>
        <Editor
          ref={editorRef}
          activeId={activeId}
          ids={ids}
          content={active?.content ?? ""}
          onChange={updateContent}
          wrap={wrap}
          fontSize={editorPrefs.editorFontSize}
          fontFamily={editorPrefs.editorFontFamily}
          spellcheck={editorPrefs.spellcheck}
          focusMode={editorPrefs.focusMode}
          typewriterMode={editorPrefs.typewriterMode}
          zenMode={zenMode}
          zenPlaceholder={t("zen.placeholder")}
          kind={active?.kind ?? "markdown"}
          docHandle={active?.handle ?? null}
          locale={lang}
          textLanguage={docLanguage?.tag ?? null}
          onCursorLineChange={onCursorMoved}
          onSelectionLinesChange={onSelectionLines}
          onImageError={(error) =>
            showNotice(
              error.kind === "tooLarge"
                ? t("image.tooLarge", error.name, error.maxMiB)
                : error.kind === "notStored"
                  ? t("image.notStored", error.name)
                  : t("image.insertFailed", error.name),
              "error",
            )
          }
        />
      </Suspense>
    </div>
  );
}
