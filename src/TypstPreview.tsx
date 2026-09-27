import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
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
 * How many pages the rendered document has.
 *
 * typst.ts draws the whole document as one `<svg class="typst-doc">` with a
 * `<g class="typst-page">` per page — counting `<svg` tags, as this once
 * did, always counted one.
 */
function countPages(svg: string): number {
  return (svg.match(/<g[^>]*class="[^"]*\btypst-page\b/g) ?? []).length;
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
};

const TypstPreview = forwardRef<TypstPreviewHandle, Props>(
  function TypstPreview({ value, t, fileSource, docPath = null }, ref) {
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

    /*
     * The handle exists so the outline, the reverse sync and the preview's
     * marking can treat every document kind alike — and for Typst they do
     * nothing, honestly. Syncing needs a map from the rendered page back to
     * source lines, and the SVG this version of typst.ts produces carries
     * no source locations at all: no `data-source-loc` (an attribute no
     * part of the toolchain emits), and the `data-span` its own interactive
     * viewer reads comes from a renderer pipeline this build does not use.
     * The code that queried those attributes could therefore never find
     * anything; what follows says so instead of pretending to look.
     */
    useImperativeHandle(ref, () => ({
      scrollToLine(_line: number) {},
      getTargetLine() {
        return 0;
      },
      clearMark() {},
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
          setPageCount(countPages(safeSvg));
          setLoading(false);
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

    return (
      <div className="typst-preview">
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
            <button type="button" onClick={() => setRetryToken((n) => n + 1)}>
              {t("preview.retry")}
            </button>
          </div>
        )}
        {svg && (
          <div className="typst-output" aria-label="Typst preview">
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
