import { useCallback, useEffect, useRef, useState } from "react";
import type { Notice } from "../components/types";

export type NoticeAPI = {
  /** Current notice or null. */
  notice: Notice | null;
  /**
   * Show a notice. `duration` 0 means persistent (no auto-dismiss).
   *
   * `owner` is who put it there, and it exists so that whoever takes it down
   * can prove it was theirs. Anything that shows a persistent notice and
   * clears it later should name itself.
   */
  showNotice: (
    message: string,
    kind?: Notice["kind"],
    duration?: number,
    owner?: string,
  ) => void;
  /**
   * Take the notice down.
   *
   * With an `owner`, only if that is who put the current one up — a caller
   * clearing its own message must not clear somebody else's. Without one it
   * clears whatever is there, which is only ever right for a caller that has
   * just decided nothing should be on screen at all.
   */
  dismissNotice: (owner?: string) => void;
};

/**
 * Ephemeral toast/notice state with auto-dismiss timer.
 *
 * Replaces the inline `notice` + `noticeTimerRef` + `showNotice` pattern
 * that was previously in App.tsx (~25 lines).
 */
export function useNotice(): NoticeAPI {
  const [notice, setNotice] = useState<Notice | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  /*
   * Who put the current notice up, if anybody said.
   *
   * A ref rather than part of the notice: nothing renders it, and
   * `dismissNotice` is a stable callback that has to read the value as it is
   * now rather than as it was when the callback was made.
   */
  const ownerRef = useRef<string | undefined>(undefined);

  const dismissNotice = useCallback((owner?: string) => {
    if (owner !== undefined && ownerRef.current !== owner) return;
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    ownerRef.current = undefined;
    setNotice(null);
  }, []);

  const showNotice = useCallback(
    (message: string, kind: Notice["kind"] = "info", duration = 3500, owner?: string) => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
      ownerRef.current = owner;
      setNotice({ message, kind });
      if (duration > 0) {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = undefined;
          setNotice(null);
        }, duration);
      }
    },
    [],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { notice, showNotice, dismissNotice };
}
