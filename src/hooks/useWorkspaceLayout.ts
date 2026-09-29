import { useCallback, useEffect, useState } from "react";
import type { LayoutMode } from "../components/types";
import { useCoarsePointer } from "./useCoarsePointer";

/**
 * How the workspace is laid out — the editor, the preview, or both — and
 * whether the pointer is coarse, which rules out having both.
 */
export function useWorkspaceLayout(initialLayout: LayoutMode) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialLayout);
  const coarsePointer = useCoarsePointer();

  /*
   * Side-by-side panes need a mouse and a wide screen; a phone has neither.
   * So on a touch screen the workspace is one pane or the other, and every
   * route into `split` lands on the reader instead — the stored preference
   * from a desktop session, Ctrl+2 from an attached keyboard, and the jumps
   * between panes, which get their own treatment further down because they
   * are aiming at a particular pane rather than at both.
   */
  const chooseLayout = useCallback(
    (mode: LayoutMode) => {
      setLayoutMode(coarsePointer && mode === "split" ? "preview" : mode);
    },
    [coarsePointer],
  );

  useEffect(() => {
    if (!coarsePointer) return;
    setLayoutMode((mode) => (mode === "split" ? "preview" : mode));
  }, [coarsePointer]);

  return { layoutMode, setLayoutMode, coarsePointer, chooseLayout };
}
