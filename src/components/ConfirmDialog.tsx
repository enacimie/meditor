import { memo, useEffect, useRef, useState } from "react";
import "./ConfirmDialog.css";

type Props = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

// Duration of the exit transition in ConfirmDialog.css — keep in sync.
const EXIT_MS = 140;

/**
 * In-window confirmation dialog (replaces the native GTK/system dialog).
 * Styled with the app theme variables and rendered above the whole UI.
 * Keyboard: Enter/Space activate the focused button, Escape cancels,
 * Tab cycles between the two buttons.
 */
const ConfirmDialog = memo(function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);

  // Focus the safe default (Cancel) on mount, and restore focus to the
  // element that opened the dialog when it closes (a11y).
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Cancel any pending exit timer if the dialog unmounts early (e.g. in tests
  // or if the parent clears it while the exit transition is playing).
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Play the CSS exit transition (the `.closing` class) before resolving, so
  // the dialog fades/scales out instead of vanishing instantly. The parent
  // only unmounts this dialog once the callback fires. The delay is skipped
  // for prefers-reduced-motion users, matching the CSS media query.
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
      requestClose(onCancel);
      return;
    }
    if (e.key === "Tab") {
      const cancel = cancelRef.current;
      const confirm = confirmRef.current;
      if (!cancel || !confirm) return;
      const active = document.activeElement;
      if (e.shiftKey && active === cancel) {
        e.preventDefault();
        confirm.focus();
      } else if (!e.shiftKey && active === confirm) {
        e.preventDefault();
        cancel.focus();
      }
    }
  };

  return (
    <div
      className={"confirm-overlay" + (closing ? " closing" : "")}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onCancel);
      }}
    >
      <div className="confirm-dialog">
        <h2 id="confirm-title" className="confirm-title">
          {title}
        </h2>
        <p id="confirm-message" className="confirm-message">
          {message}
        </p>
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-btn"
            onClick={() => requestClose(onCancel)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="confirm-btn confirm-btn--primary"
            onClick={() => requestClose(onConfirm)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
});

export default ConfirmDialog;
