import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { EditorHandle } from "./Editor";
import type { PreviewHandle } from "./Preview";
import PreviewPane from "./components/PreviewPane";
import type { LineRange } from "./editorSelection";
import Topbar from "./components/Topbar";
import TabBar from "./components/TabBar";
import StatusBar from "./components/StatusBar";
import AppDialogs from "./components/AppDialogs";
import EditorPane from "./components/EditorPane";
import SplitDivider from "./components/SplitDivider";
import { useTranslation } from "./i18n/I18nProvider";
import { isRtl } from "./i18n/translations";
import { useThemeEffect } from "./hooks/useThemeEffect";
import { useSplitDivider } from "./hooks/useSplitDivider";
import { useNotice } from "./hooks/useNotice";
import { useUpdateCheck } from "./hooks/useUpdateCheck";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useZoom } from "./hooks/useZoom";
import { usePlatform } from "./hooks/usePlatform";
import { useCursorPosition } from "./hooks/useCursorPosition";
import { useAutosave, useAutosaveNudge } from "./hooks/useAutosave";
import { useExternalChangeWatch } from "./hooks/useExternalChangeWatch";
import { useDocumentFacts } from "./hooks/useDocumentFacts";
import { useConfirmRequest, useRenameRequest } from "./hooks/useDialogRequests";
import { useRecentDocuments } from "./hooks/useRecentDocuments";
import { useDocumentActions } from "./hooks/useDocumentActions";
import { useWorkspaceLayout } from "./hooks/useWorkspaceLayout";
import { useSessionRestore } from "./hooks/useSessionRestore";
import { useExternalOpens } from "./hooks/useExternalOpens";
import { useCloseGuard } from "./hooks/useCloseGuard";
import { useSessionPersistence } from "./hooks/useSessionPersistence";
import { useCompactLayout } from "./hooks/useCompactLayout";
import type { AppScope } from "./appScope";
import { createWriters } from "./commands/writers";
import { createOperationLock } from "./commands/operationLock";
import { createFileCommands } from "./commands/fileCommands";
import { createQuit } from "./commands/quit";
import { createConflictCommands } from "./commands/conflictCommands";
import { createExportCommands } from "./commands/exportCommands";
import { createTabCommands } from "./commands/tabCommands";
import { createNavigationCommands } from "./commands/navigationCommands";
import { createShortcutHandlers } from "./commands/shortcutHandlers";

import type { Doc } from "./types";
import type { ConflictRequest, Theme } from "./components/types";
import type { EditorPreferences } from "./editorPreferences";
import { loadPreferences, savePreferences } from "./appPreferences";
import { type FileOperation, isOperationBusy } from "./fileOperations";
import {
  isPdfExportAvailable,
  isUpdateCheckAvailable,
  isRecentAvailable,
} from "./menuAvailability";
import type { DocumentStat } from "./externalChange";
import "./App.css";

const INITIAL_PREFERENCES = loadPreferences();

export default function App() {
  const { t, lang, setLanguage } = useTranslation();
  const [ready, setReady] = useState(false);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [activeId, setActiveId] = useState("");
  const [docView, setDocView] = useState(INITIAL_PREFERENCES.docView);
  const [wrap, setWrap] = useState(INITIAL_PREFERENCES.wrap);
  const [theme, setTheme] = useState<Theme>(INITIAL_PREFERENCES.theme);
  const platform = usePlatform();
  const { layoutMode, setLayoutMode, coarsePointer, chooseLayout } =
    useWorkspaceLayout(INITIAL_PREFERENCES.layoutMode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [zenMode, setZenMode] = useState(false);
  const [busyOperation, setBusyOperation] = useState<FileOperation | null>(null);
  const [conflictRequest, setConflictRequest] = useState<ConflictRequest | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [presenting, setPresenting] = useState(false);
  const [editorPrefs, setEditorPrefs] = useState<EditorPreferences>({
    editorFontSize: INITIAL_PREFERENCES.editorFontSize,
    editorFontFamily: INITIAL_PREFERENCES.editorFontFamily,
    spellcheck: INITIAL_PREFERENCES.spellcheck,
    landscapeTables: INITIAL_PREFERENCES.landscapeTables,
    focusMode: INITIAL_PREFERENCES.focusMode,
    typewriterMode: INITIAL_PREFERENCES.typewriterMode,
    paperSize: INITIAL_PREFERENCES.paperSize,
    autosave: INITIAL_PREFERENCES.autosave,
    pageMarginMm: INITIAL_PREFERENCES.pageMarginMm,
  });
  const { cursorLine, cursorColumn, onCursorMoved } = useCursorPosition();

  // Extracted hooks
  useThemeEffect(theme);
  const { split, setSplit, dragging, splitRef, splitRatioRef, onDividerDown, onDividerMove, onDividerUp } =
    useSplitDivider(50);
  const { notice, showNotice, dismissNotice } = useNotice();
  const updates = useUpdateCheck(t, { showNotice, dismissNotice });
  const { zoom, zoomIn, zoomOut, zoomReset } = useZoom();

  const editorRef = useRef<EditorHandle>(null);
  const previewRef = useRef<PreviewHandle>(null);
  // What is selected in the editor, marked in the preview. Handed straight
  // across rather than through state: nothing else here needs to redraw for it.
  const onSelectionLines = useCallback((lines: LineRange | null) => {
    previewRef.current?.showEditorSelection(lines);
  }, []);
  const docsRef = useRef<Doc[]>([]);
  const idsRef = useRef<string[]>([]);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const sessionTimerRef = useRef<number | undefined>(undefined);
  const activeIdRef = useRef("");
  const pendingOpenDocsRef = useRef<Doc[]>([]);
  const closingRef = useRef(false);
  const busyOperationRef = useRef<FileOperation | null>(null);
  // Latest translation function, read by the (once-registered) close guard.
  const closeTRef = useRef(t);
  closeTRef.current = t;
  const closeLangRef = useRef(lang);
  closeLangRef.current = lang;
  // Most recently closed tabs, so Ctrl+Shift+T can bring them back.
  const closedTabsRef = useRef<Doc[]>([]);
  // External-change watch: last seen fingerprint per registry handle, a poll
  // guard, and a flag for "the conflict modal is up" (cleared on resolution).
  const statsRef = useRef<Map<string, DocumentStat>>(new Map());
  const watchInflightRef = useRef(false);
  const conflictBusyRef = useRef(false);
  const { autosaveNudge, nudgeAutosave } = useAutosaveNudge();
  const active = docs.find((d) => d.id === activeId) ?? docs[0];
  activeIdRef.current = activeId;
  const {
    activeContent,
    activeKind,
    headings,
    markdownSyncAvailable,
    isActiveMarp,
    docLanguage,
    pageMetrics,
  } = useDocumentFacts(active, outlineOpen, editorPrefs);
  const { confirmRequest, confirmBusyRef, confirmDialog, answerConfirm } =
    useConfirmRequest(nudgeAutosave);
  const { renameRequest, setRenameRequest, renameDialog } = useRenameRequest();
  const { recent, refreshRecent, refreshRecentAfterSave } = useRecentDocuments();
  const { openPaths, updateContent, newTab, newTypstTab, newLatexTab, newMarpTab, cycleTab } =
    useDocumentActions({
      docsRef,
      activeIdRef,
      busyOperationRef,
      statsRef,
      setDocs,
      setActiveId,
    });

  const toggleZen = useCallback(() => {
    setZenMode((z) => !z);
  }, []);

  const startPresent = useCallback(() => {
    if (isOperationBusy(busyOperationRef)) return;
    setPresenting(true);
  }, []);

  const exitPresent = useCallback(() => {
    setPresenting(false);
  }, []);

  /*
   * What the commands read, as this render has it. A plain object, made
   * afresh on every render and never memoised or changed: each factory below
   * destructures its part before declaring its functions, so every command
   * still closes over the values of the render that made it.
   */
  const scope: AppScope = {
    t,
    lang,
    ready,
    docs,
    activeId,
    active,
    recent,
    platform,
    coarsePointer,
    layoutMode,
    zenMode,
    docView,
    presenting,
    pageMetrics,
    confirmRequest,
    renameRequest,
    conflictRequest,
    shortcutsOpen,
    preferencesOpen,
    aboutOpen,
    editorPrefs,
    autosaveNudge,
    docsRef,
    activeIdRef,
    statsRef,
    saveQueueRef,
    sessionSaveQueueRef,
    sessionTimerRef,
    closingRef,
    busyOperationRef,
    pendingOpenDocsRef,
    closeTRef,
    closeLangRef,
    conflictBusyRef,
    watchInflightRef,
    confirmBusyRef,
    closedTabsRef,
    splitRatioRef,
    editorRef,
    previewRef,
    setDocs,
    setActiveId,
    setReady,
    setSplit,
    setBusyOperation,
    setLayoutMode,
    setZenMode,
    setMenuOpen,
    setShortcutsOpen,
    setPreferencesOpen,
    setConflictRequest,
    showNotice,
    dismissNotice,
    nudgeAutosave,
    openPaths,
    confirmDialog,
    renameDialog,
    refreshRecent,
    refreshRecentAfterSave,
    newTab,
    newTypstTab,
    newLatexTab,
    cycleTab,
    toggleZen,
    chooseLayout,
    zoomIn,
    zoomOut,
    zoomReset,
  };
  const { adoptOwnWrite, writeFileOrdered, writeSessionOrdered } = createWriters(scope);
  const { beginOperation, endOperation } = createOperationLock(scope);
  const { openRecent, reloadFromDisk, openFiles, saveAs, save } = createFileCommands(scope, {
    beginOperation,
    endOperation,
    adoptOwnWrite,
    writeFileOrdered,
  });
  const { requestQuit } = createQuit(scope, { writeSessionOrdered });
  const { resolveConflictReload, resolveConflictKeep, resolveConflictSaveAs } =
    createConflictCommands(scope, { saveAs });
  const { exportPdf, printDocument, exportHtml } = createExportCommands(scope, {
    beginOperation,
    endOperation,
  });
  const { closeTab, closeAllTabs, closeOtherTabs, reopenTab, renameTab } =
    createTabCommands(scope);
  const {
    handleReverseSync,
    handleForwardSync,
    handleReverseSyncButton,
    toggleTask,
    findInDocument,
    findPanelReachable,
  } = createNavigationCommands(scope);
  const shortcutHandlers = createShortcutHandlers(scope, {
    save,
    saveAs,
    openFiles,
    exportPdf,
    printDocument,
    closeTab,
    reopenTab,
    renameTab,
    requestQuit,
    findInDocument,
    findPanelReachable,
  });

  // Switching away from the deck (another tab, or the front-matter removed)
  // leaves nothing to present, so drop out of the overlay instead of letting
  // it silently reappear on the way back.
  useEffect(() => {
    if (presenting && !isActiveMarp) setPresenting(false);
  }, [presenting, isActiveMarp]);

  useSessionRestore(scope);

  useLayoutEffect(() => {
    docsRef.current = docs;
    const newIds = docs.map((d) => d.id);
    const same = idsRef.current.length === newIds.length && 
      idsRef.current.every((id, i) => id === newIds[i]);
    if (!same) idsRef.current = newIds;
  }, [docs]);

  useExternalOpens(scope);
  useCloseGuard(requestQuit);
  useSessionPersistence(scope, writeSessionOrdered);

  useEffect(() => {
    document.title = active?.name ?? "meditor";
  }, [active?.name]);

  useAutosave(scope, { writeFileOrdered });

  useExternalChangeWatch(scope);



  useEffect(() => {
    if (!ready) return;
    savePreferences({ docView, wrap, theme, layoutMode, ...editorPrefs });
  }, [docView, wrap, theme, layoutMode, editorPrefs, ready]);

  const compactLayout = useCompactLayout();

  useEffect(() => {
    void refreshRecent();
  }, [refreshRecent]);

  // Keyboard shortcuts — extracted to its own hook
  useKeyboardShortcuts(ready, shortcutHandlers);

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash-inner">
          <div className="splash-logo">meditor</div>
          <div className="splash-bar">
            <div className="splash-bar-fill" />
          </div>
          <div className="splash-hint">{t("app.loading")}</div>
        </div>
      </div>
    );
  }

  const pdfExportAvailable = isPdfExportAvailable(activeKind, platform);
  const updateCheckAvailable = isUpdateCheckAvailable(platform);
  const recentAvailable = isRecentAvailable(platform);

  /*
   * Pane sizing is decided here rather than left to the stylesheet. The divider
   * ratio only means anything while both panes share the workspace; the rest of
   * the time the visible pane takes all of it.
   *
   * It is written inline in both cases on purpose. Leaving the ratio in place
   * and overriding it from CSS put `flex: 1 1 100% !important` up against an
   * inline `flex: 0 0 50%`, and the Windows and macOS CI runners did not
   * reliably resolve that the way the cascade says they should — the pane kept
   * half the width with dead space beside it. Removing the attribute instead
   * left a narrower version of the same race. An inline value that is simply
   * correct for the current mode has neither problem.
   */
  const sharingTheWorkspace = layoutMode === "split" && !zenMode;
  const paneFlex = (percent: number) =>
    sharingTheWorkspace ? `0 0 ${percent}%` : "1 1 100%";

  return (
    <div
      className={
        "app" +
        (zenMode ? " zen" : "") +
        // Split is the default, so it needs no class of its own.
        (layoutMode !== "split" ? ` layout-${layoutMode}` : "")
      }
    >
      <Topbar
        t={t}
        lang={lang}
        setLanguage={setLanguage}
        notice={notice}
        busyOperation={busyOperation}
        menuOpen={menuOpen}
        setMenuOpen={setMenuOpen}
        theme={theme}
        setTheme={setTheme}
        zenMode={zenMode}
        onToggleZen={toggleZen}
        onNew={newTab}
        onNewTypst={newTypstTab}
        onNewLatex={newLatexTab}
        onNewMarp={newMarpTab}
        onPresent={isActiveMarp && !presenting ? startPresent : undefined}
        onOpen={openFiles}
        onSave={save}
        onSaveAs={saveAs}
        // Only where there is a file to read back. The recent rows are gated
        // the same way, and for the same reason: a row that cannot do
        // anything teaches nothing by being there.
        onReload={active?.handle ? reloadFromDisk : undefined}
        recent={recent}
        onOpenRecent={recentAvailable ? openRecent : undefined}
        onExportPdf={pdfExportAvailable ? exportPdf : undefined}
        onExportHtml={active?.kind === "markdown" ? exportHtml : undefined}
        onCloseAll={closeAllTabs}
        onCloseOthers={closeOtherTabs}
        onAbout={() => setAboutOpen(true)}
        onCheckUpdates={updateCheckAvailable ? updates.checkForUpdates : undefined}
        onPreferences={() => setPreferencesOpen(true)}
        layoutMode={layoutMode}
        onLayoutModeChange={chooseLayout}
        onFind={findInDocument}
        coarsePointer={coarsePointer}
      />
      {zenMode && (
        <button
          type="button"
          className="zen-exit"
          onClick={() => setZenMode(false)}
          aria-label={t("menu.zenExit")}
          title={`${t("menu.zenExit")} (F11 / Esc)`}
        >
          <span aria-hidden="true">×</span>
          <span>{t("menu.zenExit")}</span>
        </button>
      )}
      <TabBar
        t={t}
        docs={docs}
        activeId={activeId}
        busyOperation={busyOperation}
        rtl={isRtl(lang)}
        onSelectTab={setActiveId}
        onCloseTab={closeTab}
        onRenameTab={renameTab}
        onNewTab={newTab}
      />
      <div
        id="workspace-panels"
        className={"split" + (dragging ? " dragging" : "")}
        ref={splitRef}
        role="tabpanel"
        aria-labelledby={active ? `tab-${active.id}` : undefined}
        aria-label={active?.name ?? ""}
        tabIndex={-1}
      >
        <EditorPane
          t={t}
          flex={paneFlex(split)}
          markdownSyncAvailable={markdownSyncAvailable}
          handleForwardSync={handleForwardSync}
          coarsePointer={coarsePointer}
          editorRef={editorRef}
          wrap={wrap}
          setWrap={setWrap}
          outlineOpen={outlineOpen}
          setOutlineOpen={setOutlineOpen}
          headings={headings}
          cursorLine={cursorLine}
          activeId={activeId}
          ids={idsRef.current}
          active={active}
          updateContent={updateContent}
          editorPrefs={editorPrefs}
          zenMode={zenMode}
          lang={lang}
          docLanguage={docLanguage}
          onCursorMoved={onCursorMoved}
          onSelectionLines={onSelectionLines}
          showNotice={showNotice}
        />
        <SplitDivider
          t={t}
          compactLayout={compactLayout}
          split={split}
          setSplit={setSplit}
          splitRatioRef={splitRatioRef}
          onDividerDown={onDividerDown}
          onDividerMove={onDividerMove}
          onDividerUp={onDividerUp}
        />
        <PreviewPane
          t={t}
          flex={paneFlex(100 - split)}
          markdownSyncAvailable={markdownSyncAvailable}
          handleReverseSyncButton={handleReverseSyncButton}
          active={active}
          isActiveMarp={isActiveMarp}
          docView={docView}
          setDocView={setDocView}
          previewRef={previewRef}
          editorPrefs={editorPrefs}
          pageMetrics={pageMetrics}
          docLanguage={docLanguage}
          theme={theme}
          toggleTask={toggleTask}
          handleReverseSync={handleReverseSync}
        />
      </div>
      <StatusBar
        t={t}
        content={active?.content ?? ""}
        docName={active?.name}
        dirty={active?.dirty}
        cursorLine={cursorLine + 1}
        cursorColumn={cursorColumn}
        zoom={zoom}
        onZoomReset={zoomReset}
      />
      <AppDialogs
        t={t}
        confirmRequest={confirmRequest}
        answerConfirm={answerConfirm}
        updates={updates}
        conflictRequest={conflictRequest}
        renameRequest={renameRequest}
        resolveConflictReload={resolveConflictReload}
        resolveConflictKeep={resolveConflictKeep}
        resolveConflictSaveAs={resolveConflictSaveAs}
        setRenameRequest={setRenameRequest}
        preferencesOpen={preferencesOpen}
        setPreferencesOpen={setPreferencesOpen}
        aboutOpen={aboutOpen}
        setAboutOpen={setAboutOpen}
        shortcutsOpen={shortcutsOpen}
        setShortcutsOpen={setShortcutsOpen}
        editorPrefs={editorPrefs}
        setEditorPrefs={setEditorPrefs}
        presenting={presenting}
        isActiveMarp={isActiveMarp}
        activeContent={activeContent}
        exitPresent={exitPresent}
      />
    </div>
  );
}
