const ALLOWED_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "title",
  "desc",
  "style",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "text",
  "tspan",
  "use",
  "symbol",
  "marker",
  "pattern",
  "lineargradient",
  "radialgradient",
  "stop",
  "clippath",
  "mask",
  "filter",
  "fegaussianblur",
  "feoffset",
  "femerge",
  "femergenode",
  "fecolormatrix",
  "feblend",
  "image",
]);

const ALLOWED_ATTRIBUTES = new Set([
  "id",
  "class",
  "x",
  "y",
  "x1",
  "x2",
  "y1",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "width",
  "height",
  "viewbox",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-opacity",
  "opacity",
  "transform",
  "font-family",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
  "preserveaspectratio",
  "marker-end",
  "marker-start",
  "markerwidth",
  "markerheight",
  "refx",
  "refy",
  "orient",
  "offset",
  "stop-color",
  "stop-opacity",
  "clip-path",
  "clip-rule",
  "mask",
  "filter",
  "flood-color",
  "flood-opacity",
  "result",
  "in",
  "in2",
  "mode",
  "values",
  "type",
  "color-interpolation-filters",
  "style",
  "xmlns",
  "xmlns:xlink",
  "href",
  "xlink:href",
]);

const BLOCKED_ELEMENTS = new Set([
  "script",
  "foreignobject",
  "iframe",
  "object",
  "embed",
  "link",
  "audio",
  "video",
]);

const REFERENCE_ATTRIBUTES = new Set([
  "href",
  "xlink:href",
  "marker-end",
  "marker-start",
  "clip-path",
  "mask",
  "filter",
]);

const CSS_DANGEROUS_RE = /(?:@import|url\s*\(|expression\s*\(|javascript\s*:|-moz-binding|behavior\s*:|<|>)/i;
const BLOCKED_ELEMENT_RE = /script|foreignobject|iframe|object|embed|link|audio|video/i;
const RASTER_DATA_URI_RE = /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i;

function isSafeReference(value: string): boolean {
  const normalized = value.trim();
  return (
    normalized.startsWith("#") ||
    /^url\(\s*#[^)\s]+\s*\)$/i.test(normalized) ||
    RASTER_DATA_URI_RE.test(normalized)
  );
}

function isSafeCss(value: string): boolean {
  return !CSS_DANGEROUS_RE.test(value);
}

function sanitizeElement(element: Element): void {
  const tag = element.tagName.toLowerCase();
  if (BLOCKED_ELEMENTS.has(tag) || !ALLOWED_ELEMENTS.has(tag)) {
    element.remove();
    return;
  }

  if (tag === "style") {
    if (!isSafeCss(element.textContent ?? "")) element.remove();
    return;
  }

  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value;
    const unsafeReference = REFERENCE_ATTRIBUTES.has(name) && !isSafeReference(value);
    if (
      name.startsWith("on") ||
      !ALLOWED_ATTRIBUTES.has(name) ||
      unsafeReference ||
      (name === "style" && !isSafeCss(value))
    ) {
      element.removeAttribute(attribute.name);
    }
  }

  for (const child of Array.from(element.children)) {
    sanitizeElement(child);
  }
}

/**
 * Return safe SVG markup, or an empty string when parsing fails.
 *
 * Typst emits a helper `<script>` in complex documents. Its JavaScript can
 * contain XML-invalid text such as `&&`, so remove blocked elements before
 * strict XML parsing; otherwise a safe document would be rejected before the
 * sanitizer had a chance to remove the executable content.
 */
export function sanitizeSvg(svg: string): string {
  if (!svg || typeof DOMParser === "undefined") return "";
  const blocked = BLOCKED_ELEMENT_RE.source;
  const withoutBlockedElements = svg
    .replace(
      new RegExp(`<\\s*(${blocked})\\b[^>]*>[\\s\\S]*?<\\s*\\/\\s*\\1\\s*>`, "gi"),
      "",
    )
    .replace(new RegExp(`<\\s*(?:${blocked})\\b[^>]*\\/\\s*>`, "gi"), "");
  const document = new DOMParser().parseFromString(
    withoutBlockedElements,
    "image/svg+xml",
  );
  if (document.querySelector("parsererror")) return "";
  const root = document.documentElement;
  sanitizeElement(root);
  return root.tagName.toLowerCase() === "svg" ? root.outerHTML : "";
}
