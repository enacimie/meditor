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

/*
 * What may never appear in CSS, in an attribute or in a stylesheet.
 *
 * `<` is on the list because the sanitised SVG goes back into the page through
 * `innerHTML`: a stylesheet reading `</style><script>...` is text to the
 * parser that checks it and markup to the parser that inserts it, which is the
 * one way CSS here can become script. `>` on its own opens nothing, and it is
 * the CSS child combinator, so it is not on the list -- blocking it threw away
 * whole stylesheets over an ordinary selector.
 */
const CSS_DANGEROUS_RE =
  /(?:@import|expression\s*\(|javascript\s*:|-moz-binding|behavior\s*:|<)/i;

/** Any `url()` at all, for the places where none is allowed. */
const CSS_ANY_URL_RE = /url\s*\(/i;

/**
 * Every `url()` in a stylesheet, with whatever it points at.
 *
 * The quote is captured so that the same one has to close it, and the target
 * is read without it: `url(#a)`, `url('#a')` and `url("#a")` are one thing
 * written three ways, and a check that understood only the bare form would
 * wave the other two through unread.
 */
const CSS_URL_RE = /url\s*\(\s*(['"]?)([^)'"]*)\1\s*\)/gi;
const SAME_DOCUMENT_REFERENCE_RE = /^#[A-Za-z0-9_:.-]+$/;
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

/**
 * CSS for a `style` attribute, where nothing may reach outside the element.
 *
 * No `url()` of any kind: an attribute on one shape has no business pointing
 * anywhere, and the reference attributes that legitimately do — `fill`,
 * `marker-end` and the rest — are checked by `isSafeReference` instead.
 */
function isSafeCss(value: string): boolean {
  return !CSS_DANGEROUS_RE.test(value) && !CSS_ANY_URL_RE.test(value);
}

/**
 * CSS for a `<style>` element.
 *
 * The same rules, with one opening: a stylesheet may point at this document's
 * own definitions, because `marker-end: url(#arrowhead)` is how an SVG draws
 * an arrow and every diagram with one is written that way. Each `url()` is
 * read on its own and has to be a bare `#id`; a path, a scheme, a
 * protocol-relative host or a data URI fails, so a stylesheet still cannot
 * make the page fetch anything.
 *
 * A `url()` this pattern cannot parse at all — an unbalanced quote, say —
 * matches nothing and would slip through the loop, so anything containing
 * `url(` must also match the strict form exactly as many times as it appears.
 */
function isSafeStylesheetCss(text: string): boolean {
  if (CSS_DANGEROUS_RE.test(text)) return false;
  if (!CSS_ANY_URL_RE.test(text)) return true;

  const parsed = [...text.matchAll(CSS_URL_RE)];
  const written = text.match(new RegExp(CSS_ANY_URL_RE.source, "gi")) ?? [];
  if (parsed.length !== written.length) return false;

  return parsed.every((match) => SAME_DOCUMENT_REFERENCE_RE.test(match[2].trim()));
}

function sanitizeElement(element: Element): void {
  const tag = element.tagName.toLowerCase();
  if (BLOCKED_ELEMENTS.has(tag) || !ALLOWED_ELEMENTS.has(tag)) {
    element.remove();
    return;
  }

  if (tag === "style") {
    if (!isSafeStylesheetCss(element.textContent ?? "")) element.remove();
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
