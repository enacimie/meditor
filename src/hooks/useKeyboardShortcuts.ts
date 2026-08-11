import { useEffect, useRef } from "react";

export type ShortcutHandlers = {
  /** Ctrl+S / Cmd+S */
  save: () => void;
  /** Ctrl+Shift+S / Cmd+Shift+S */
  saveAs: () => void;
  /** Ctrl+O / Cmd+O */
  openFiles: () => void;
  /** Ctrl+N / Cmd+N */
  newTab: () => void;
  /** Ctrl+Shift+N / Cmd+Shift+N */
  newTypst: () => void;
  /** Ctrl+E / Cmd+E */
  exportPdf: () => void;
  /** Ctrl+W / Cmd+W */
  closeTab: () => void;
  /** F11 */
  toggleZen: () => void;
  /** F2 */
  rename: () => void;
  /** F1 */
  openShortcuts: () => void;
  /** Ctrl+K / Cmd+K */
  focusSearch: () => void;
};

/**
 * Registers global keyboard shortcuts for the app.
 *
 * Replaces the inline `useEffect` with the `onKey` handler that was
 * previously in App.tsx (~30 lines).
 */
export function useKeyboardShortcuts(
  ready: boolean,
  handlers: ShortcutHandlers,
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    // Only register once `ready` is true and we have valid handlers.
    // The `ready` guard prevents shortcuts from firing during the splash screen.
    const onKey = (e: KeyboardEvent) => {
      const h = handlersRef.current;

      if (e.key === "F11") {
        e.preventDefault();
        h.toggleZen();
        return;
      }

      if (e.key === "F2") {
        e.preventDefault();
        h.rename();
        return;
      }

      if (e.key === "F1") {
        e.preventDefault();
        h.openShortcuts();
        return;
      }

      if (!ready || !(e.ctrlKey || e.metaKey)) return;

      const k = e.key.toLowerCase();

      if (k === "s") {
        e.preventDefault();
        if (e.shiftKey) h.saveAs();
        else h.save();
      } else if (k === "o") {
        e.preventDefault();
        h.openFiles();
      } else if (k === "n") {
        e.preventDefault();
        if (e.shiftKey) h.newTypst();
        else h.newTab();
      } else if (k === "e") {
        e.preventDefault();
        h.exportPdf();
      } else if (k === "w") {
        e.preventDefault();
        h.closeTab();
      } else if (k === "k") {
        e.preventDefault();
        h.focusSearch();
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready]);
}
