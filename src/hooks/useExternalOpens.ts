import { useEffect } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppScope } from "../appScope";
import type { Doc } from "../types";

const MAX_PENDING_OPEN_DOCS = 256;

/**
 * Documents the desktop backend hands over while the application is running,
 * as its `open-documents` event: opened at once, or held until the file
 * operation in progress lets go of the lock.
 */
export function useExternalOpens(
  scope: Pick<AppScope, "busyOperationRef" | "pendingOpenDocsRef" | "openPaths">,
) {
  const { busyOperationRef, pendingOpenDocsRef, openPaths } = scope;

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    listen<Doc[]>("open-documents", (e) => {
      if (busyOperationRef.current !== null) {
        pendingOpenDocsRef.current.push(...e.payload);
        if (pendingOpenDocsRef.current.length > MAX_PENDING_OPEN_DOCS) {
          pendingOpenDocsRef.current.splice(
            0,
            pendingOpenDocsRef.current.length - MAX_PENDING_OPEN_DOCS,
          );
          console.warn("Dropped stale external opens due to queue overflow");
        }
      } else {
        void openPaths(e.payload);
      }
    }).then((f) => {
      if (cancelled) f();
      else unlisten = f;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [busyOperationRef, pendingOpenDocsRef, openPaths]);
}
