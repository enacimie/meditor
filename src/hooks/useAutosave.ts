import { useState } from "react";

/** A counter the autosave timer watches besides `docs`, and the call that bumps it. */
export function useAutosaveNudge() {
  /**
   * Ask autosave to look again.
   *
   * Its timer is armed by `docs` changing, which is the debounce and is right
   * for typing — but a pass that *declines* to run changes no document, so on
   * its own nothing would ever ask a second time. Waiting out a file dialog,
   * an export, or a conflict dialog therefore meant the edits behind it were
   * never written at all: not late, never. Answering "keep mine" to a
   * conflict was the worst of them, because the buffer the writer had just
   * chosen to defend was the one left unsaved.
   */
  const [autosaveNudge, setAutosaveNudge] = useState(0);
  const nudgeAutosave = () => setAutosaveNudge((n) => n + 1);

  return { autosaveNudge, nudgeAutosave };
}
