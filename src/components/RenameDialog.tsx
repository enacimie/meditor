import { memo, useEffect, useRef, useState } from "react";
import "./RenameDialog.css";

type Props = {
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (name: string) => void;
  onCancel: () => void;
};

// Duration of the exit transition in RenameDialog.css — keep in sync.
const EXIT_MS = 140;

/**
 * In-window rename dialog (replaces the native window.prompt).
 * Styled with the app theme variables and rendered above the whole UI.
 * Keyboard: Enter confirms (from the input), Escape cancels, Tab/Shift+Tab
 * cycle input → Cancel → Rename (focus is trapped inside the dialog).
 * On close, focus is restored to the element that opened the dialog.
 */
const RenameDialog = memo(function RenameDialog({
  title,
  label,
  initialValue,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [value, setValue] = useState(initialValue);
  const [closing, setClosing] = useState(false);
  const trimmed = value.trim();
  const canConfirm = trimmed.length > 0;

  // Focus and select the current name so typing replaces it, and restore
  // focus to the element that opened the dialog when it closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Cancel any pending exit timer if the dialog unmounts early.
  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== undefined) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  // Play the CSS exit transition (the `.closing` class) before resolving, so
  // the dialog fades/scales out instead of vanishing instantly. The delay is
  // skipped for prefers-reduced-motion users, matching the CSS media query.
  const requestClose = (finish: () => void) => {
    if (closing) return;
    setClosing(true);
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    closeTimerRef.current = window.setTimeout(finish, reduced ? 0 : EXIT_MS);
  };

  const submit = () => {
    if (canConfirm) requestClose(() => onConfirm(trimmed));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      requestClose(onCancel);
      return;
    }
    if (e.key === "Tab") {
      // Trap the focus inside the dialog: wrap at both ends of
      // input → Cancel → Rename, and pull stray focus back in.
      const active = document.activeElement;
      if (!e.shiftKey && active === confirmRef.current) {
        e.preventDefault();
        cancelRef.current?.focus();
      } else if (e.shiftKey && active === inputRef.current) {
        e.preventDefault();
        confirmRef.current?.focus();
      } else if (
        active !== inputRef.current &&
        active !== cancelRef.current &&
        active !== confirmRef.current
      ) {
        e.preventDefault();
        (e.shiftKey ? confirmRef.current : inputRef.current)?.focus();
      }
    }
  };

  return (
    <div
      className={"rename-overlay" + (closing ? " closing" : "")}
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-title"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose(onCancel);
      }}
    >
      <div className="rename-dialog">
        <h2 id="rename-title" className="rename-title">
          {title}
        </h2>
        <label className="rename-label" htmlFor="rename-input">
          {label}
        </label>
        <input
          id="rename-input"
          ref={inputRef}
          className="rename-input"
          type="text"
          value={value}
          maxLength={120}
          aria-label={label}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="rename-actions">
          <button
            ref={cancelRef}
            type="button"
            className="rename-btn"
            onClick={() => requestClose(onCancel)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rename-btn rename-btn--primary"
            disabled={!canConfirm}
            onClick={submit}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
});

export default RenameDialog;
