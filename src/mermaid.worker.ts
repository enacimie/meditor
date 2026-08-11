/**
 * Mermaid Web Worker
 *
 * Renders Mermaid diagrams in a worker thread to avoid blocking the UI.
 * Uses a minimal DOM shim because Mermaid relies on browser DOM APIs.
 * Falls back gracefully: if the worker can't render a diagram (e.g.
 * missing font metrics), the main thread catches the error and renders
 * it on the main thread instead.
 */

// ── Minimal DOM shim ──────────────────────────────────────────────
// Mermaid needs document.createElement, element.innerHTML, appendChild,
// getElementById, and text measurement via getBBox/getComputedTextLength.

type ShimElement = {
  tagName: string;
  children: ShimElement[];
  attributes: Record<string, string>;
  innerHTML: string;
  textContent: string;
  style: Record<string, string>;
  // Methods added after creation
  setAttribute?: (name: string, value: string) => void;
  getAttribute?: (name: string) => string | null;
  appendChild?: (child: ShimElement) => ShimElement;
  removeChild?: (child: ShimElement) => ShimElement;
  getBBox?: () => DOMRect;
  getComputedTextLength?: () => number;
  querySelector?: (sel: string) => ShimElement | null;
  querySelectorAll?: (sel: string) => ShimElement[];
};

function createShimElement(tagName: string): ShimElement {
  return {
    tagName: tagName.toLowerCase(),
    children: [],
    attributes: {},
    innerHTML: "",
    textContent: "",
    style: {},
  };
}

function shimSetAttribute(this: ShimElement, name: string, value: string) {
  this.attributes[name] = value;
}

function shimGetAttribute(this: ShimElement, name: string): string | null {
  return this.attributes[name] ?? null;
}

function shimAppendChild(this: ShimElement, child: ShimElement): ShimElement {
  this.children.push(child);
  return child;
}

function shimRemoveChild(this: ShimElement, child: ShimElement): ShimElement {
  const idx = this.children.indexOf(child);
  if (idx >= 0) this.children.splice(idx, 1);
  return child;
}

function shimGetBBox(): DOMRect {
  return { x: 0, y: 0, width: 0, height: 0 } as DOMRect;
}

function shimGetComputedTextLength(): number {
  return 0;
}

function shimQuerySelector(this: ShimElement, _selector: string): ShimElement | null {
  return null;
}

function shimQuerySelectorAll(this: ShimElement, _selector: string): ShimElement[] {
  return [];
}

interface ShimDocument {
  createElement: (tag: string) => ShimElement;
  createElementNS: (_ns: string, tag: string) => ShimElement;
  getElementById: (id: string) => ShimElement | null;
  querySelector: (sel: string) => ShimElement | null;
  querySelectorAll: (sel: string) => ShimElement[];
  body: ShimElement;
  documentElement: ShimElement;
  createTextNode: (text: string) => { textContent: string };
}

let doc: ShimDocument;

function addElementMethods(el: ShimElement) {
  el.setAttribute = shimSetAttribute.bind(el);
  el.getAttribute = shimGetAttribute.bind(el);
  el.appendChild = shimAppendChild.bind(el);
  el.removeChild = shimRemoveChild.bind(el);
  el.getBBox = shimGetBBox;
  el.getComputedTextLength = shimGetComputedTextLength;
  el.querySelector = shimQuerySelector.bind(el);
  el.querySelectorAll = shimQuerySelectorAll.bind(el);
}

function createShimDocument(): ShimDocument {
  const byId = new Map<string, ShimElement>();

  const d: ShimDocument = {
    createElement(tag: string): ShimElement {
      const el = createShimElement(tag);
      addElementMethods(el);
      return el;
    },
    createElementNS(_ns: string, tag: string): ShimElement {
      const el = createShimElement(tag);
      addElementMethods(el);
      return el;
    },
    getElementById(id: string): ShimElement | null {
      return byId.get(id) ?? null;
    },
    querySelector(_sel: string): ShimElement | null {
      return null;
    },
    querySelectorAll(_sel: string): ShimElement[] {
      return [];
    },
    body: createShimElement("body"),
    documentElement: createShimElement("html"),
    createTextNode(text: string) {
      return { textContent: text };
    },
  };

  // Intercept setAttribute('id', ...) to populate byId
  const origCreateElement = d.createElement.bind(d);
  const origCreateElementNS = d.createElementNS.bind(d);

  d.createElement = (tag: string): ShimElement => {
    const el = origCreateElement(tag);
    const origSetAttr = el.setAttribute!;
    el.setAttribute = (name: string, value: string) => {
      origSetAttr(name, value);
      if (name === "id") byId.set(value, el);
    };
    return el;
  };

  d.createElementNS = (ns: string, tag: string): ShimElement => {
    const el = origCreateElementNS(ns, tag);
    const origSetAttr = el.setAttribute!;
    el.setAttribute = (name: string, value: string) => {
      origSetAttr(name, value);
      if (name === "id") byId.set(value, el);
    };
    return el;
  };

  return d;
}

// ── Worker message handling ───────────────────────────────────────

type RenderRequest = { id: number; src: string };
type RenderResponse = { type: "result"; id: number; svg?: string; error?: string };

let mermaidReady = false;
let mermaidInitPromise: Promise<void> | undefined;

async function ensureMermaid(): Promise<void> {
  if (mermaidReady) return;
  if (mermaidInitPromise) return mermaidInitPromise;

  mermaidInitPromise = (async () => {
    const mermaidModule = await import("mermaid");

    doc = createShimDocument();
    (self as unknown as Record<string, unknown>).document = doc;
    (self as unknown as Record<string, unknown>).window = self;

    mermaidModule.default.initialize({
      startOnLoad: false,
      securityLevel: "loose",
      suppressErrorRendering: true,
      theme: "default",
    });

    mermaidReady = true;
  })();

  return mermaidInitPromise;
}

async function renderDiagram(id: number, src: string): Promise<RenderResponse> {
  try {
    await ensureMermaid();
    const mermaidModule = await import("mermaid");
    const mermaid = mermaidModule.default;

    const { svg } = await mermaid.render(`worker-mmd-${id}`, src);
    return { type: "result", id, svg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { type: "result", id, error: message };
  }
}

self.onmessage = async (e: MessageEvent<RenderRequest>) => {
  const { id, src } = e.data;
  const response = await renderDiagram(id, src);
  self.postMessage(response);
};

self.postMessage({ type: "ready" });
