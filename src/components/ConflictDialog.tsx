import { memo, useEffect, useRef, useState } from "react";
import { useDialogKeys } from "../hooks/useDialogKeys";
import "./ConflictDialog.css";

type Props = {
  title: string;
  message: string;
  reloadLabel: string;
  keepLabel: string;
  saveAsLabel: string;
  onReload: () => void;
  onKeep: () => void;
  onSaveAs: () => void;
};

// Duration of the exit transition in ConflictDialog.css — keep in sync.
const EXIT_MS = 140;

/**
 * Three-way resolution for a document that changed on disk while carrying
 * unsaved edits. Deliberately not dismissible: Escape and the backdrop both
 * route to "keep mine" so no keypress can silently discard either version,
 * and every exit is one of the three explicit choices. The Tab trap runs on
 * the document and knows all three buttons — cycling only the two refs that
 * happen to exist used to walk the focus out of the modal from the third.
 */
const ConflictDialog = memo(function ConflictDialog({
  title,
  message,
  reloadLabel,
  keepLabel,
  saveAsLabel,
  onReload,
  onKeep,
  onSaveAs,
}: Props) {
  const keepRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);

  // Focus the non-destructive default on mount, and restore focus to the
  // element that opened the dialog when it closes (a11y).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    keepRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  const requestClose = (finish: () => void) => {
    if (closing) return;
    setClosing(true);
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    closeTimerRef.current = window.setTimeout(finish, reduced ? 0 : EXIT_MS);
  };

  useDialogKeys(panelRef, () => requestClose(onKeep));

  return (
    <div
      className={"conflict-overlay" + (closing ? " closing" : "")}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-message"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onKeep);
      }}
    >
      <div className="conflict-dialog" ref={panelRef}>
        <h2 id="conflict-title" className="conflict-title">
          {title}
        </h2>
        <p id="conflict-message" className="conflict-message">
          {message}
        </p>
        <div className="conflict-actions">
          <button
            type="button"
            className="confirm-btn conflict-btn--danger"
            onClick={() => requestClose(onReload)}
          >
            {reloadLabel}
          </button>
          <button
            ref={keepRef}
            type="button"
            className="confirm-btn"
            onClick={() => requestClose(onKeep)}
          >
            {keepLabel}
          </button>
          <button
            type="button"
            className="confirm-btn confirm-btn--primary"
            onClick={() => requestClose(onSaveAs)}
          >
            {saveAsLabel}
          </button>
        </div>
      </div>
    </div>
  );
});

export default ConflictDialog;
