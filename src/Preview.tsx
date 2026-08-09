import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  type MouseEvent,
} from "react";
import mermaid from "mermaid";
import { Previewer } from "pagedjs";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderMarkdown } from "./markdown";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";
import pagedCss from "./paged.css?inline";

mermaid.initialize({ startOnLoad: false, securityLevel: "strict" });

const PAGED_STYLES: Array<Record<string, string>> = [
  { "meditor-paged.css": pagedCss },
];

let seq = 0;

const CODE_BLOCK_MAX_LINES = 45;

function splitLongCodeBlocks(src: string): string {
  const FENCE_RE = /(^|\n)((```|~~~)[ \t]*[^\n]*)\n([\s\S]*?)\n\3[ \t]*(?=\n|$)/g;
  return src.replace(FENCE_RE, (match, pre, open, marker, body) => {
    const bodyLines = body.split("\n");
    if (bodyLines.length <= CODE_BLOCK_MAX_LINES) return match;
    const chunks: string[] = [];
    for (let i = 0; i < bodyLines.length; i += CODE_BLOCK_MAX_LINES) {
      chunks.push(
        open + "\n" + bodyLines.slice(i, i + CODE_BLOCK_MAX_LINES).join("\n") + "\n" + marker,
      );
    }
    return pre + chunks.join("\n");
  });
}

async function renderContent(el: HTMLElement, value: string): Promise<void> {
  el.innerHTML = renderMarkdown(value);
  const nodes = Array.from(el.querySelectorAll("code.language-mermaid"));
  for (const code of nodes) {
    const pre = code.parentElement;
    if (!pre) continue;
    const src = code.textContent ?? "";
    const id = `mmd-${seq++}`;
    const line = pre.getAttribute("data-line");
    let div: HTMLDivElement;
    try {
      const { svg } = await mermaid.render(id, src);
      div = document.createElement("div");
      div.className = "mermaid";
      div.innerHTML = svg;
    } catch (err) {
      div = document.createElement("div");
      div.className = "mermaid-error";
      div.textContent = "Mermaid: " + (err as Error).message;
    }
    if (line) div.setAttribute("data-line", line);
    pre.replaceWith(div);
  }
}

function collectStyles(): Array<Record<string, string>> {
  return PAGED_STYLES;
}

async function openExternal(url: string) {
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
      window.setTimeout(() => target.classList.remove("sync-flash"), 1300);
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
      if (/^https?:\/\//i.test(href)) {
        e.preventDefault();
        void openExternal(href);
        return;
      }
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
    }
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-line]");
    if (el) markElement(el);
    else clearMark();
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

    const run = async () => {
      markedLineRef.current = null;
      markedElRef.current = null;
      if (docView) {
        const source = sourceRef.current;
        const paged = pagedRef.current;
        if (!source || !paged) return;
        await renderContent(source, splitLongCodeBlocks(value));
        if (cancelled) return;
        paged.innerHTML = "";
        const previewer = new Previewer();
        try {
          const html = `<div class="markdown-body doc">${source.innerHTML}</div>`;
          await previewer.preview(html, collectStyles(), paged);
        } catch (e) {
          console.error("paged.js:", e);
        }
      } else {
        const web = webRef.current;
        if (!web) return;
        await renderContent(web, value);
      }
    };

    if (docView) {
      const t = setTimeout(run, 250);
      return () => {
        cancelled = true;
        clearTimeout(t);
      };
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [value, docView]);

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
    </>
  );
});

export default Preview;
