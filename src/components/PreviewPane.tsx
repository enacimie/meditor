import type { Dispatch, RefObject, SetStateAction } from "react";
import Preview, { type PreviewHandle } from "../Preview";
import type { DocumentLanguage } from "../documentLanguage";
import type { EditorPreferences } from "../editorPreferences";
import type { TranslationFn } from "../i18n/translations";
import type { PageMetrics } from "../pageSetup";
import type { Doc } from "../types";
import type { Theme } from "./types";

type Props = {
  t: TranslationFn;
  /** The pane's share of the workspace, as a CSS `flex` value. */
  flex: string;
  markdownSyncAvailable: boolean;
  handleReverseSyncButton: () => void;
  active: Doc | undefined;
  isActiveMarp: boolean;
  docView: boolean;
  setDocView: Dispatch<SetStateAction<boolean>>;
  previewRef: RefObject<PreviewHandle | null>;
  editorPrefs: EditorPreferences;
  pageMetrics: PageMetrics;
  docLanguage: DocumentLanguage | null;
  theme: Theme;
  toggleTask: (line: number) => void;
  handleReverseSync: (line: number) => void;
};

/**
 * The preview's side of the workspace: its header, with the jump back to the
 * code and the Document/Web switch, and the preview itself.
 *
 * It keeps no state: App decides everything it shows and hands it down.
 */
export default function PreviewPane({
  t,
  flex,
  markdownSyncAvailable,
  handleReverseSyncButton,
  active,
  isActiveMarp,
  docView,
  setDocView,
  previewRef,
  editorPrefs,
  pageMetrics,
  docLanguage,
  theme,
  toggleTask,
  handleReverseSync,
}: Props) {
  return (
    <div className="pane" style={{ flex }}>
      <div className="pane-header">
        <span className="pane-title">{t("pane.preview")}</span>
        {markdownSyncAvailable && (
          <button
            type="button"
            className="sync-btn"
            onClick={handleReverseSyncButton}
            aria-label={t("pane.scrollToCode")}
            title={t("pane.scrollToCode")}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" />
              <path d="m11 18-6-6 6-6" />
            </svg>
            {t("pane.goToCode")}
          </button>
        )}
        {(active?.kind ?? "markdown") !== "typst" && (active?.kind ?? "markdown") !== "latex" && !isActiveMarp && (
          <button
            type="button"
            className={docView ? "sync-btn on" : "sync-btn"}
            onClick={() => setDocView((v) => !v)}
            aria-label={t("pane.viewMode")}
            title={t("pane.viewMode")}
          >
            <span className="pane-view-label">{docView ? t("pane.document") : t("pane.web")}</span>
          </button>
        )}
      </div>
      <div
        className={
          "preview-scroll" +
          (docView && (active?.kind ?? "markdown") === "markdown" && !isActiveMarp ? " doc-bg" : "")
        }
      >
        <Preview
          ref={previewRef}
          value={active?.content ?? ""}
          docView={docView}
          kind={active?.kind ?? "markdown"}
          landscapeTables={editorPrefs.landscapeTables}
          pageMetrics={pageMetrics}
          language={docLanguage}
          docHandle={active?.handle ?? null}
          docPath={active?.path ?? null}
          theme={theme}
          onToggleTask={toggleTask}
          onReverseSync={handleReverseSync}
        />
      </div>
    </div>
  );
}
