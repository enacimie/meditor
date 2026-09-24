import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import type { TranslationFn } from "./i18n/translations";
import { isMobilePlatform, usePlatform } from "./hooks/usePlatform";
import { getTypst } from "./typstEngine";
import {
  MAX_DEPTH,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_TOTAL_BYTES,
  prepareTypst,
  typstMainName,
  type PreparedTypst,
  type TypstFileProblem,
  type TypstFileSource,
} from "./typstFiles";
import type { TypstApi } from "./typstWorkerProtocol";
import { sanitizeSvg } from "./sanitizeSvg";
import "./Preview.css";

/**
 * The element the Typst SVG goes into, and the one its stylesheet is kept in.
 *
 * The SVG typst.ts writes carries a stylesheet, and once the SVG is in the page
 * so are its rules. One of them is a bare `svg { fill: none; }`, which blanked
 * every icon in the interface drawn with a fill (the menu's ⋮) while a Typst
 * document was open. Its selectors are put under this element instead.
 */
const SVG_WRAPPER = "typst-svg-wrapper";

/**
 * How often the files a document reads are looked at again, for a change
 * made in another program: a figure exported again, a chapter edited
 * elsewhere. Each look is one backend call per file, and a compile only when
 * one of them moved.
 */
const FILES_POLL_MS = 3000;

const MIB = 1024 * 1024;

/** Why a file was left out, in words. */
function problemText(problem: TypstFileProblem, t: TranslationFn): string {
  switch (problem.reason) {
    case "invalid":
    case "outside":
      return t("preview.typstFileOutside");
    case "unsupported":
      return t("preview.typstFileUnsupported");
    case "tooLarge":
      return t("preview.typstFileTooLarge", MAX_FILE_BYTES / MIB);
    default:
      return t("preview.typstFileLimit", MAX_FILES, MAX_TOTAL_BYTES / MIB, MAX_DEPTH);
  }
}

/**
 * Parse a data-source-loc attribute from typst.ts SVGs.
 * Format is typically "line:column" or "startLine:startCol,endLine:endCol".
 * Returns the start line (1-based from Typst, 0-based for the editor).
 */
function parseSourceLine(loc: string): number {
  const comma = loc.indexOf(",");
  const segment = comma > 0 ? loc.slice(0, comma) : loc;
  const colon = segment.indexOf(":");
  const lineStr = colon > 0 ? segment.slice(0, colon) : segment;
  const line = parseInt(lineStr, 10);
  return isNaN(line) ? -1 : line;
}

export type TypstPreviewHandle = {
  scrollToLine: (line: number) => void;
  getTargetLine: () => number;
  clearMark: () => void;
};

type Props = {
  value: string;
  t: TranslationFn;
  /**
   * Where the files the document reads are found: the saved document, and
   * the language for the backend's messages. Absent for a document that has
   * never been saved, which has no folder yet.
   */
  fileSource?: TypstFileSource;
  /** The document's path, whose last part is its name in that folder. */
  docPath?: string | null;
  onReverseSync: (line: number) => void;
};

const TypstPreview = forwardRef<TypstPreviewHandle, Props>(
  function TypstPreview({ value, t, fileSource, docPath = null, onReverseSync }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const outputRef = useRef<HTMLDivElement>(null);
    const [svg, setSvg] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [retryToken, setRetryToken] = useState(0);
    const [pageCount, setPageCount] = useState(0);
    /** What the last compile could not be given, and why. */
    const [files, setFiles] = useState<Pick<PreparedTypst, "problems" | "unavailable">>({
      problems: [],
      unavailable: null,
    });
    /** Bumped when a file the document reads changed on disk. */
    const [filesMoved, setFilesMoved] = useState(0);
    /** What the last compile was given, for the poll to compare with. */
    const signatureRef = useRef<string | null>(null);
    const valueRef = useRef(value);
    const mainName = typstMainName(docPath);
    const platform = usePlatform();
    // An unsaved document on the desktop gets a folder by being saved;
    // anywhere else, saving it gives the backend no folder to read.
    const savingHelps = isTauri() && !isMobilePlatform(platform);
    const seqRef = useRef(0);
    const markedElRef = useRef<Element | null>(null);
    const markedLineRef = useRef<number | null>(null);
    const flashTimerRef = useRef<number | undefined>(undefined);

    useImperativeHandle(ref, () => ({
      scrollToLine(line: number) {
        const container = containerRef.current;
        if (!container) return;
        // Typst lines are 1-based, editor lines are 0-based
        const typstLine = line + 1;
        // Find the first element whose source-loc starts at this line
        const candidates = Array.from(
          container.querySelectorAll<HTMLElement>("[data-source-loc]"),
        );
        let target: HTMLElement | null = null;
        for (const el of candidates) {
          const loc = el.getAttribute("data-source-loc");
          if (!loc) continue;
          const parsed = parseSourceLine(loc);
          if (parsed < 0) continue;
          if (parsed <= typstLine) target = el;
          else break;
        }
        if (!target && candidates.length) target = candidates[0];
        if (!target) return;
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.classList.remove("sync-flash");
        void (target as HTMLElement).offsetWidth;
        target.classList.add("sync-flash");
        if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
        flashTimerRef.current = window.setTimeout(() => {
          flashTimerRef.current = undefined;
          target?.classList.remove("sync-flash");
        }, 1300);
      },
      getTargetLine(): number {
        if (markedLineRef.current !== null) return markedLineRef.current;
        const container = containerRef.current;
        if (!container) return 0;
        const scroller = container.closest(".preview-scroll") as HTMLElement | null;
        const top = scroller ? scroller.getBoundingClientRect().top : 0;
        const nodes = Array.from(
          container.querySelectorAll<HTMLElement>("[data-source-loc]"),
        );
        for (const n of nodes) {
          if (n.getBoundingClientRect().bottom >= top) {
            const loc = n.getAttribute("data-source-loc") ?? "";
            const parsed = parseSourceLine(loc);
            // Convert 1-based Typst line to 0-based editor line
            return parsed > 0 ? parsed - 1 : 0;
          }
        }
        return 0;
      },
      clearMark() {
        if (markedElRef.current) {
          markedElRef.current.classList.remove("sync-marked");
        }
        markedElRef.current = null;
        markedLineRef.current = null;
      },
    }));

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    useEffect(() => {
      let cancelled = false;
      const run = async () => {
        let $typst: TypstApi;
        try {
          const mod = await getTypst();
          $typst = mod.$typst;
        } catch {
          if (!cancelled) {
            setError("Could not load Typst compiler");
          }
          return;
        }
        if (cancelled) return;
        setLoading(true);
        setError(null);
        seqRef.current++;
        const mySeq = seqRef.current;
        try {
          const prepared = await prepareTypst(value, mainName, fileSource);
          if (cancelled || mySeq !== seqRef.current) return;
          signatureRef.current = prepared.signature;
          setFiles({ problems: prepared.problems, unavailable: prepared.unavailable });
          const result = await $typst.svg(prepared.input);
          const safeSvg = sanitizeSvg(result, { scopeStylesTo: `.${SVG_WRAPPER}` });
          if (!safeSvg) throw new Error("Typst produced invalid or unsafe SVG");
          if (cancelled || mySeq !== seqRef.current) return;
          setSvg(safeSvg);
          setLoading(false);
          // Count <svg> elements to know how many pages were rendered
          const count = (safeSvg.match(/<svg[\s>]/g) || []).length;
          setPageCount(count);
        } catch (e) {
          if (cancelled || mySeq !== seqRef.current) return;
          const message = e instanceof Error ? e.message : String(e);
          setError(`${t("preview.typstError")} ${message}`);
          setLoading(false);
        }
      };
      // Debounce: Typst compilation is fast but we still want to avoid
      // spamming recompilations on every keystroke.
      const timer = window.setTimeout(() => {
        void run();
      }, 250);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }, [value, t, retryToken, filesMoved, mainName, fileSource]);

    // A file the document reads can change while the document does not:
    // look again every few seconds, and on coming back to the window, and
    // compile again only when what the compiler would be given has moved.
    useEffect(() => {
      if (!fileSource) return;
      let stopped = false;
      const look = () => {
        if (document.visibilityState === "hidden") return;
        prepareTypst(valueRef.current, mainName, fileSource)
          .then(({ signature }) => {
            if (!stopped && signature !== signatureRef.current) setFilesMoved((n) => n + 1);
          })
          .catch(() => undefined);
      };
      const timer = window.setInterval(look, FILES_POLL_MS);
      window.addEventListener("focus", look);
      return () => {
        stopped = true;
        window.clearInterval(timer);
        window.removeEventListener("focus", look);
      };
    }, [fileSource, mainName]);

    function handleClick(e: MouseEvent) {
      const el = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-source-loc]",
      );
      if (el) {
        if (markedElRef.current && markedElRef.current !== el) {
          markedElRef.current.classList.remove("sync-marked");
        }
        el.classList.add("sync-marked");
        markedElRef.current = el;
        const loc = el.getAttribute("data-source-loc") ?? "";
        const parsed = parseSourceLine(loc);
        if (parsed > 0) {
          markedLineRef.current = parsed - 1; // 0-based
          onReverseSync(markedLineRef.current);
        }
      } else {
        if (markedElRef.current) {
          markedElRef.current.classList.remove("sync-marked");
        }
        markedElRef.current = null;
        markedLineRef.current = null;
      }
    }

    return (
      <div
        ref={containerRef}
        className="typst-preview"
        onClick={handleClick}
      >
        {(files.unavailable || files.problems.length > 0) && (
          <div className="typst-files-notice" role="status">
            {files.unavailable && (
              <p>
                {files.unavailable === "unsaved" && savingHelps
                  ? t("preview.typstFilesUnsaved")
                  : t("preview.typstFilesDesktopOnly")}
              </p>
            )}
            {files.problems.length > 0 && (
              <>
                <p>{t("preview.typstFilesLeftOut")}</p>
                <ul>
                  {files.problems.map((problem) => (
                    <li key={problem.path}>
                      <code>{problem.path}</code>: {problemText(problem, t)}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {loading && !svg && (
          <div className="typst-loading" role="status">
            <span className="typst-spinner" aria-hidden="true" />
            {t("preview.typstCompiling")}
          </div>
        )}
        {error && (
          <div className="preview-error" role="alert" aria-live="assertive">
            <strong>{t("preview.unavailable")}</strong>
            <span>{error}</span>
            <button type="button" onClick={() => setRetryToken((t) => t + 1)}>
              {t("preview.retry")}
            </button>
          </div>
        )}
        {svg && (
          <div
            ref={outputRef}
            className="typst-output"
            aria-label="Typst preview"
          >
            {pageCount > 1 && (
              <span className="typst-page-counter" aria-live="polite">
                {pageCount} {t("preview.pages")}
              </span>
            )}
            <div className={SVG_WRAPPER} dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
        )}
      </div>
    );
  },
);

export default TypstPreview;
