import { memo, useEffect, useRef, useState } from "react";
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
 * and every exit is one of the three explicit choices.
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
  const reloadRef = useRef<HTMLButtonElement>(null);
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose(onKeep);
      return;
    }
    if (e.key === "Tab") {
      // Three buttons: cycle within the dialog instead of into the page
      // behind the modal.
      const buttons = [reloadRef.current, keepRef.current];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (index === -1) return;
      e.preventDefault();
      const next = e.shiftKey
        ? buttons[(index + buttons.length - 1) % buttons.length]
        : buttons[(index + 1) % buttons.length];
      next?.focus();
    }
  };

  return (
    <div
      className={"conflict-overlay" + (closing ? " closing" : "")}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="conflict-title"
      aria-describedby="conflict-message"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onKeep);
      }}
    >
      <div className="conflict-dialog">
        <h2 id="conflict-title" className="conflict-title">
          {title}
        </h2>
        <p id="conflict-message" className="conflict-message">
          {message}
        </p>
        <div className="conflict-actions">
          <button
            ref={reloadRef}
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
