import { useEffect } from "react";
import type { AppScope } from "../appScope";
import { backend } from "../backend";
import { makeDoc, newId, normalizeDoc, seedWatchBaselines } from "../documentUtils";
import { SAMPLE } from "../sample";
import type { Doc } from "../types";

/**
 * Start-up, once: the documents the last session left open and the files the
 * application was asked to open, or the sample when there is neither. Marks
 * the application ready when it is done.
 */
export function useSessionRestore(
  scope: Pick<
    AppScope,
    "lang" | "statsRef" | "splitRatioRef" | "setDocs" | "setActiveId" | "setSplit" | "setReady"
  >,
) {
  const { lang, statsRef, splitRatioRef, setDocs, setActiveId, setSplit, setReady } = scope;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      let base: Doc[] = [];
      let startActive = "";
      let cliDocs: Doc[] = [];
      // Both backends answer these: Rust reads its session file, the web
      // backend localStorage; an empty result means "start with the sample".
      try {
        cliDocs = (await backend.cliFiles(lang)).map(normalizeDoc);
      } catch {
        cliDocs = [];
      }
      try {
        const restored = await backend.loadSession(lang);
        if (restored) {
          base = restored.docs.map(normalizeDoc);
          startActive = restored.activeId;
          splitRatioRef.current = restored.split;
        }
      } catch (error) {
        console.warn("Could not restore session", error);
        base = [];
      }
      if (!base.length) {
        const d = makeDoc(SAMPLE, base);
        base = [d];
        startActive = d.id;
      }
      let cliActive = "";
      for (const incoming of cliDocs) {
        const ex = base.find((d) => d.path === incoming.path);
        if (ex) {
          if (!cliActive) cliActive = ex.id;
          continue;
        }
        base.push({ ...normalizeDoc(incoming), id: newId() });
        if (!cliActive) cliActive = base[base.length - 1].id;
      }
      if (cancelled) return;
      if (cliActive) startActive = cliActive;
      seedWatchBaselines(statsRef.current, base);
      setDocs(base);
      if (!startActive || !base.some((d) => d.id === startActive)) {
        startActive = base[0]?.id ?? "";
      }
      setActiveId(startActive);
      setSplit(splitRatioRef.current);
      setReady(true);
    })();

    return () => {
      cancelled = true;
    };
  // Startup should run once; language is read from the render that starts it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setSplit, splitRatioRef]);
}
