import { useEffect, useRef, type RefObject } from "react";

/**
 * What the Tab trap considers focusable. Disabled controls are out: the
 * browser refuses to focus them, and a trap that counts one cycles to a
 * button that cannot be reached — which is how a dialog with a disabled
 * default (Rename with an empty name) loses the focus out of the modal.
 */
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Escape and Tab ownership for a modal dialog, enforced on the document
 * rather than on the overlay.
 *
 * A React `onKeyDown` on the overlay only hears keys while the focus is
 * somewhere inside it, and the focus does leave: a click on the panel's
 * title or padding puts it on `document.body`, and from there Escape
 * belongs to the app's global handler — which reads it as "exit zen" —
 * while Tab walks into the page behind a dialog that is still announcing
 * itself as `aria-modal`. Listening on the document keeps the dialog in
 * charge of its two keys wherever the focus has wandered, and pulling a
 * stray focus back on Tab is what makes the trap one in fact and not only
 * in markup.
 *
 * Escape also stops propagating: the global handler listens on the window,
 * one node further up, and must not answer a key this dialog has consumed.
 */
export function useDialogKeys(
  panelRef: RefObject<HTMLElement | null>,
  onEscape: () => void,
): void {
  // The callback arrives fresh on every render of the dialog; the listener
  // subscribes once and reads the current one through the ref.
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        escapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = Array.from(
        panel.querySelectorAll<HTMLElement>(FOCUSABLE),
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [panelRef]);
}
