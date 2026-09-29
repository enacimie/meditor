import { useCallback, useRef, useState } from "react";
import { backend } from "../backend";
import type { RecentEntry } from "../backend/types";

/**
 * The recent documents the main menu lists, and the two ways of reading the
 * list again. App reads it once on start.
 */
export function useRecentDocuments() {
  /*
   * The recent documents, as the backend last listed them.
   *
   * Refreshed after anything that reorders the backend's list, and that is not
   * cosmetic: a click sends the *position* in this list, so a copy that has
   * gone stale would open the document that took the clicked one's place.
   * Opening a recent document reorders it too — the one just opened moves to
   * the top — so that path refreshes as well.
   */
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  // The same list without waiting for a render, for the saves that have to
  // know whether they moved it. Written wherever `setRecent` is.
  const recentRef = useRef<RecentEntry[]>([]);

  /**
   * Re-read the list, and hand it back as well as storing it.
   *
   * Returned because the backend prunes the entries whose files have gone on
   * the way out, so what comes back answers a question the caller cannot
   * otherwise ask: whether the document somebody just clicked is still there.
   * The state is a render behind at that point and cannot be consulted.
   */
  const refreshRecent = useCallback(async (): Promise<RecentEntry[]> => {
    try {
      // Whatever comes back, the list this holds is a list. A save consults
      // it, and a save must not be able to fail over the menu's bookkeeping.
      const entries = (await backend.recentFiles()) ?? [];
      recentRef.current = entries;
      setRecent(entries);
      return entries;
    } catch (error) {
      // A menu section that fails to load is not worth interrupting anyone
      // over; the rest of the menu still works.
      console.error("could not read the recent documents:", error);
      recentRef.current = [];
      setRecent([]);
      return [];
    }
  }, []);

  /**
   * Re-read the list after a save that will have reordered it.
   *
   * Saving promotes the document to the front of the backend's list — that is
   * deliberate, it is how a document worked on all week keeps its place — and
   * the menu is clicked by *position*. So a stale copy does not merely look
   * out of date: click the row labelled `A.md` after saving `B.md`, and the
   * index that travels is the one `B.md` now occupies, and `B.md` opens.
   *
   * Only when the order actually moved. `remember` returns early when the
   * path is already at the front, so a document saved twice running rewrites
   * nothing, and neither does this — which matters with an autosave writing
   * every couple of seconds.
   */
  function refreshRecentAfterSave(path: string | null | undefined): void {
    // Nothing in here may throw. It is called from inside the write, whose
    // `catch` means "this document could not be saved" — and the first
    // version of this could throw, on a backend that answered the list with
    // something other than an array. A successful save then reported itself
    // as a failure, which the autosave tests caught and which would have been
    // a great deal harder to work out from a bug report.
    if (!path || recentRef.current[0]?.path === path) return;
    void refreshRecent();
  }

  return { recent, refreshRecent, refreshRecentAfterSave };
}
