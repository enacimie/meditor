import { memo, useEffect, useId, useRef, useState } from "react";
import { useDialogKeys } from "../hooks/useDialogKeys";
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
 * Tab cycles between the two buttons — owned on the document, so they
 * keep working when a click on the panel has put the focus on the body.
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
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [closing, setClosing] = useState(false);
  /*
   * Generated, not static: the application can mount two of these at once
   * (a question and the update offer), and two `confirm-title` ids in the
   * DOM would point both `aria-labelledby`s at whichever came first.
   */
  const titleId = useId();
  const messageId = useId();

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

  useDialogKeys(panelRef, () => requestClose(onCancel));

  return (
    <div
      className={"confirm-overlay" + (closing ? " closing" : "")}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onCancel);
      }}
    >
      <div className="confirm-dialog" ref={panelRef}>
        <h2 id={titleId} className="confirm-title">
          {title}
        </h2>
        <p id={messageId} className="confirm-message">
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
