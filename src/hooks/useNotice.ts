import { useCallback, useEffect, useRef, useState } from "react";
import type { Notice } from "../components/types";

export type NoticeAPI = {
  /** Current notice or null. */
  notice: Notice | null;
  /** Show a notice. `duration` 0 means persistent (no auto-dismiss). */
  showNotice: (message: string, kind?: Notice["kind"], duration?: number) => void;
  /** Dismiss the current notice immediately. */
  dismissNotice: () => void;
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

  const dismissNotice = useCallback(() => {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setNotice(null);
  }, []);

  const showNotice = useCallback(
    (message: string, kind: Notice["kind"] = "info", duration = 3500) => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current);
        timerRef.current = undefined;
      }
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
