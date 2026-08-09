import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { Previewer } from "pagedjs";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import pagedCss from "./paged.css?inline";

let mermaidPromise: Promise<typeof import("mermaid")> | undefined;
let markdownPromise: Promise<typeof import("./markdown")> | undefined;
let markdownStylesPromise: Promise<unknown[]> | undefined;

async function getMarkdownRenderer() {
  markdownPromise ??= import("./markdown");
  markdownStylesPromise ??= Promise.all([
    import("katex/dist/katex.min.css"),
    import("highlight.js/styles/github.css"),
  ]);
  const [{ renderMarkdown }] = await Promise.all([
    markdownPromise,
    markdownStylesPromise,
  ]);
  return renderMarkdown;
}

async function getMermaid() {
  mermaidPromise ??= import("mermaid").then((module) => {
    module.default.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
    });
    return module;
  });
  return (await mermaidPromise).default;
}

const PAGED_STYLES: Array<Record<string, string>> = [
  { "meditor-paged.css": pagedCss },
];

const CODE_BLOCK_MAX_LINES = 45;

async function renderContent(
  el: HTMLElement,
  value: string,
  seqRef: React.MutableRefObject<number>,
  isStale: () => boolean,
): Promise<void> {
  const renderMarkdown = await getMarkdownRenderer();
  if (isStale()) return;
  el.innerHTML = renderMarkdown(value);
  const nodes = Array.from(el.querySelectorAll("code.language-mermaid"));
  for (const code of nodes) {
    if (isStale()) return;
    const pre = code.parentElement;
    if (!pre) continue;
    const src = code.textContent ?? "";
    const id = `mmd-${seqRef.current++}`;
    const line = pre.getAttribute("data-line");
    let div: HTMLDivElement;
    try {
      const mermaid = await getMermaid();
      const { svg } = await mermaid.render(id, src);
      if (isStale()) return;
      div = document.createElement("div");
      div.className = "mermaid";
      div.innerHTML = svg;
    } catch (err) {
      if (isStale()) return;
      div = document.createElement("div");
      div.className = "mermaid-error";
      div.textContent = "Mermaid: " + (err instanceof Error ? err.message : String(err));
    }
    if (isStale()) return;
    if (line) div.setAttribute("data-line", line);
    pre.replaceWith(div);
  }
}

function collectStyles(): Array<Record<string, string>> {
  return PAGED_STYLES;
}

function isSafeExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:";
  } catch {
    return false;
  }
}

async function openExternal(url: string) {
  if (!isSafeExternalUrl(url)) {
    console.warn("Enlace externo bloqueado:", url);
    return;
  }
  if (isTauri()) {
    try {
      await openUrl(url);
    } catch (e) {
      console.error("No se pudo abrir el enlace:", e);
    }
  } else {
    window.open(url, "_blank", "noopener");
  }
}

export type PreviewHandle = {
  scrollToLine: (line: number) => void;
  getTargetLine: () => number;
  clearMark: () => void;
};

type Props = {
  value: string;
  docView: boolean;
  onReverseSync: (line: number) => void;
};

const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { value, docView, onReverseSync },
  ref,
) {
  const sourceRef = useRef<HTMLDivElement>(null);
  const webRef = useRef<HTMLDivElement>(null);
  const pagedRef = useRef<HTMLDivElement>(null);
  const markedLineRef = useRef<number | null>(null);
  const markedElRef = useRef<HTMLElement | null>(null);
  const docViewRef = useRef(docView);
  docViewRef.current = docView;
  const onReverseSyncRef = useRef(onReverseSync);
  onReverseSyncRef.current = onReverseSync;

  const seqRef = useRef(0);
  const tokenRef = useRef(0);
  const flashTimerRef = useRef<number | undefined>(undefined);
  const activePreviewerRef = useRef<Previewer | undefined>(undefined);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  function destroyPreviewer(previewer: Previewer | undefined): void {
    if (!previewer) return;
    const { polisher, chunker } = previewer as unknown as {
      polisher?: { destroy(): void };
      chunker?: { destroy(): void };
    };
    polisher?.destroy();
    chunker?.destroy();
  }

  async function getPreviewer(): Promise<Previewer> {
    destroyPreviewer(activePreviewerRef.current);
    const { Previewer } = await import("pagedjs");
    const previewer = new Previewer();
    activePreviewerRef.current = previewer;
    return previewer;
  }

  function splitLongCodeBlocks(el: HTMLElement): void {
    const pres = Array.from(el.querySelectorAll("pre"));
    for (const pre of pres) {
      const code = pre.querySelector("code");
      if (!code) continue;
      const lines = code.innerHTML.split("\n");
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      if (lines.length <= CODE_BLOCK_MAX_LINES) continue;
      const baseLine = parseInt(pre.getAttribute("data-line") || "0", 10);
      const codeClass = code.getAttribute("class") || "";
      const chunks: string[] = [];
      for (let i = 0; i < lines.length; i += CODE_BLOCK_MAX_LINES) {
        const chunkDataLine = baseLine + i;
        chunks.push(
          `<pre data-line="${chunkDataLine}"><code class="${codeClass}">${lines
            .slice(i, i + CODE_BLOCK_MAX_LINES)
            .join("\n")}</code></pre>`,
        );
      }
      const wrap = document.createElement("span");
      wrap.innerHTML = chunks.join("");
      pre.replaceWith(...Array.from(wrap.childNodes));
    }
  }

  function activeContainer(): HTMLElement | null {
    return docViewRef.current ? pagedRef.current : webRef.current;
  }

  useImperativeHandle(ref, () => ({
    scrollToLine(line: number) {
      const container = activeContainer();
      if (!container) return;
      const nodes = Array.from(
        container.querySelectorAll<HTMLElement>("[data-line]"),
      );
      let target: HTMLElement | null = null;
      for (const n of nodes) {
        const l = parseInt(n.getAttribute("data-line") || "0", 10);
        if (l <= line) target = n;
        else break;
      }
      if (!target && nodes.length) target = nodes[0];
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.remove("sync-flash");
      void target.offsetWidth;
      target.classList.add("sync-flash");
      flashTimerRef.current && clearTimeout(flashTimerRef.current);
      flashTimerRef.current = window.setTimeout(() => {
        flashTimerRef.current = undefined;
        target?.classList.remove("sync-flash");
      }, 1300);
    },
    getTargetLine() {
      if (markedLineRef.current !== null) return markedLineRef.current;
      const container = activeContainer();
      if (!container) return 0;
      const scroller = container.closest(".preview-scroll") as HTMLElement | null;
      const top = scroller ? scroller.getBoundingClientRect().top : 0;
      const nodes = Array.from(
        container.querySelectorAll<HTMLElement>("[data-line]"),
      );
      for (const n of nodes) {
        if (n.getBoundingClientRect().bottom >= top) {
          return parseInt(n.getAttribute("data-line") || "0", 10);
        }
      }
      return 0;
    },
    clearMark,
  }));

  function clearMark() {
    if (markedElRef.current) markedElRef.current.classList.remove("sync-marked");
    markedElRef.current = null;
    markedLineRef.current = null;
  }

  function markElement(el: HTMLElement) {
    if (markedElRef.current && markedElRef.current !== el) {
      markedElRef.current.classList.remove("sync-marked");
    }
    el.classList.add("sync-marked");
    markedElRef.current = el;
    markedLineRef.current = parseInt(el.getAttribute("data-line") || "0", 10);
  }

  function handleClick(e: MouseEvent) {
    const link = (e.target as HTMLElement).closest("a[href]");
    if (link) {
      const href = link.getAttribute("href") || "";
      if (href.startsWith("#")) {
        e.preventDefault();
        try {
          const target = activeContainer()?.querySelector(href);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
          }
        } catch {
          /* selector inválido */
        }
        return;
      }
      e.preventDefault();
      void openExternal(href);
      return;
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
    if (el) {
      markElement(el);
      if (markedLineRef.current !== null) {
        onReverseSyncRef.current(markedLineRef.current);
      }
    } else clearMark();
  }

  function handleDblClick(e: MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
    if (!el) return;
    markElement(el);
    if (markedLineRef.current !== null) {
      onReverseSyncRef.current(markedLineRef.current);
    }
  }

useEffect(() => {
    let cancelled = false;
    let debounceTimer: number | undefined;

    const run = async () => {
      markedLineRef.current = null;
      markedElRef.current = null;
      setRenderError(null);
      tokenRef.current++;
      const myToken = tokenRef.current;
      const isStale = () => cancelled || myToken !== tokenRef.current;
      if (docView) {
        const source = sourceRef.current;
        const paged = pagedRef.current;
        if (!source || !paged) return;
        await renderContent(source, value, seqRef, isStale);
        if (cancelled || myToken !== tokenRef.current) return;
        splitLongCodeBlocks(source);
        paged.innerHTML = "";
        let previewer: Previewer;
        try {
          previewer = await getPreviewer();
          if (cancelled || myToken !== tokenRef.current) return;
          const html = `<div class="markdown-body doc">${source.innerHTML}</div>`;
          await previewer.preview(html, collectStyles(), paged);
          if (cancelled || myToken !== tokenRef.current) {
            if (activePreviewerRef.current === previewer) {
              activePreviewerRef.current = undefined;
            }
            destroyPreviewer(previewer);
          }
        } catch (e) {
          if (!isStale()) {
            const message = e instanceof Error ? e.message : String(e);
            setRenderError(`No se pudo generar la vista Documento: ${message}`);
          }
          console.error("paged.js:", e);
        }
      } else {
        const web = webRef.current;
        if (!web) return;
        await renderContent(web, value, seqRef, isStale);
      }
    };

    const schedule = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        void run().catch((e) => {
          if (!cancelled) {
            const message = e instanceof Error ? e.message : String(e);
            setRenderError(`No se pudo generar la vista previa: ${message}`);
          }
          console.error("preview:", e);
        });
      }, docView ? 250 : 50);
    };

    schedule();
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [value, docView, retryToken]);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current !== undefined) {
        window.clearTimeout(flashTimerRef.current);
      }
      destroyPreviewer(activePreviewerRef.current);
      activePreviewerRef.current = undefined;
    };
  }, []);

  return (
    <>
      <div ref={sourceRef} className="markdown-body doc preview-source" />
      <div
        ref={webRef}
        className="markdown-body"
        style={{ display: docView ? "none" : "block" }}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
      />
      <div
        ref={pagedRef}
        className="paged-view"
        style={{ display: docView ? "block" : "none" }}
        onClick={handleClick}
        onDoubleClick={handleDblClick}
      />
      {renderError && (
        <div className="preview-error" role="alert" aria-live="assertive">
          <strong>Vista previa no disponible</strong>
          <span>{renderError}</span>
          <button type="button" onClick={() => setRetryToken((token) => token + 1)}>
            Reintentar
          </button>
        </div>
      )}
    </>
  );
});

export default Preview;
