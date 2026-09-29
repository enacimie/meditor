import type { AppScope } from "../appScope";
import type { ShortcutHandlers } from "../hooks/useKeyboardShortcuts";
import type { createExportCommands } from "./exportCommands";
import type { createFileCommands } from "./fileCommands";
import type { createNavigationCommands } from "./navigationCommands";
import type { createQuit } from "./quit";
import type { createTabCommands } from "./tabCommands";

type Siblings = Pick<ReturnType<typeof createFileCommands>, "save" | "saveAs" | "openFiles"> &
  Pick<ReturnType<typeof createExportCommands>, "printDocument"> &
  Pick<ReturnType<typeof createTabCommands>, "closeTab" | "reopenTab" | "renameTab"> &
  ReturnType<typeof createQuit> &
  Pick<ReturnType<typeof createNavigationCommands>, "findInDocument" | "findPanelReachable"> & {
    exportPdf: () => Promise<void>;
  };

/** What each keyboard shortcut does, as this render has it. */
export function createShortcutHandlers(
  scope: Pick<
    AppScope,
    | "ready"
    | "activeId"
    | "presenting"
    | "zenMode"
    | "confirmRequest"
    | "renameRequest"
    | "shortcutsOpen"
    | "aboutOpen"
    | "setShortcutsOpen"
    | "setMenuOpen"
    | "setPreferencesOpen"
    | "setZenMode"
    | "newTab"
    | "newTypstTab"
    | "newLatexTab"
    | "cycleTab"
    | "toggleZen"
    | "chooseLayout"
    | "zoomIn"
    | "zoomOut"
    | "zoomReset"
  >,
  {
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
  }: Siblings,
): ShortcutHandlers {
  const {
    ready,
    activeId,
    presenting,
    zenMode,
    confirmRequest,
    renameRequest,
    shortcutsOpen,
    aboutOpen,
    setShortcutsOpen,
    setMenuOpen,
    setPreferencesOpen,
    setZenMode,
    newTab,
    newTypstTab,
    newLatexTab,
    cycleTab,
    toggleZen,
    chooseLayout,
    zoomIn,
    zoomOut,
    zoomReset,
  } = scope;

  return {
    save,
    saveAs,
    openFiles,
    newTab,
    newTypst: newTypstTab,
    newLatex: newLatexTab,
    exportPdf,
    print: printDocument,
    closeTab: () => closeTab(activeId),
    reopenTab,
    quit: requestQuit,
    toggleZen,
    rename: () => renameTab(activeId),
    // Open-only on purpose: closing always routes through the overlay's
    // animated path (Esc/backdrop/✕). Toggling off here would unmount the
    // overlay directly and skip the exit transition. Guarded with `ready` so
    // F1 during the splash screen cannot queue an overlay to pop on mount.
    openShortcuts: () => {
      if (!ready || shortcutsOpen) return;
      setShortcutsOpen(true);
    },
    find: () => {
      if (!findPanelReachable()) return;
      // A slideshow covers the whole window: the panel would open behind it
      // and take the keys the presentation is listening for.
      if (presenting) return;
      // The menu's own Find entry closes the menu; its shortcut does too.
      setMenuOpen(false);
      findInDocument();
    },
    setLayout: chooseLayout,
    zoomIn,
    zoomOut,
    zoomReset,
    openPreferences: () => {
      if (!ready || confirmRequest || renameRequest) return;
      // Two aria-modal dialogs at once would trap focus in the wrong one.
      if (shortcutsOpen || aboutOpen) return;
      setPreferencesOpen(true);
    },
    nextTab: () => cycleTab(1),
    prevTab: () => cycleTab(-1),
    exitZen: () => {
      if (zenMode) setZenMode(false);
    },
  };
}
