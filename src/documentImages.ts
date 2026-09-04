import { backend } from "./backend";

/**
 * Images a document points at with a relative path.
 *
 * `![](assets/shot.png)` means "next to this file" in every Markdown tool
 * there is, and the preview could not honour it: a webview has no filesystem,
 * and this app deliberately grants it none. The bytes therefore come back
 * through the backend, and this is where they are turned into something an
 * `<img>` can use and kept there.
 *
 * Kept, because the preview re-renders on every keystroke. Reading a
 * five-megabyte photograph each time a letter is typed is not an option, and
 * neither is caching it forever: an image edited in another program has to
 * show up. So each entry is revalidated against the file's fingerprint, which
 * costs one metadata call per image per render and nothing else.
 */

/** Enough for a long illustrated document without holding a gallery in memory. */
const MAX_CACHE_BYTES = 64 * 1024 * 1024;

type CacheEntry = {
  url: string;
  bytes: number;
  modifiedMs: number | null;
  size: number | null;
};

/** Insertion-ordered, so the oldest entry is the first key. */
const cache = new Map<string, CacheEntry>();
let cachedBytes = 0;

function cacheKey(handle: string, relPath: string): string {
  // Keyed by document as well as path: two open documents in different
  // folders both saying `assets/shot.png` mean two different files.
  return `${handle}::${relPath}`;
}

function revoke(entry: CacheEntry): void {
  try {
    URL.revokeObjectURL(entry.url);
  } catch {
    /* already gone, or a document that never had object URLs */
  }
}

function evict(key: string): void {
  const entry = cache.get(key);
  if (!entry) return;
  revoke(entry);
  cachedBytes -= entry.bytes;
  cache.delete(key);
}

function makeRoom(incoming: number): void {
  for (const key of [...cache.keys()]) {
    if (cachedBytes + incoming <= MAX_CACHE_BYTES) break;
    evict(key);
  }
}

/** Drop every cached image and release its object URL. */
export function clearImageCache(): void {
  for (const key of [...cache.keys()]) evict(key);
  cachedBytes = 0;
}

/**
 * Whether a link points at a file beside the document rather than elsewhere.
 *
 * Everything with a scheme, a protocol-relative prefix or a leading slash is
 * already loadable by the browser and is left alone. What is left is the
 * relative path the backend knows how to find.
 */
export function isDocumentRelative(src: string): boolean {
  if (!src) return false;
  if (src.startsWith("//") || src.startsWith("/")) return false;
  // A scheme, per RFC 3986: a letter followed by letters, digits, +, - or .
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return false;
  // A Windows path is absolute too, whatever platform is asking.
  if (/^[a-z]:[\\/]/i.test(src)) return false;
  if (src.startsWith("\\")) return false;
  return true;
}

/**
 * The path as the backend should be given it.
 *
 * markdown-it percent-encodes the links it writes, so a file with a space or
 * an accent in its name arrives here as `assets/mi%20foto.png` and would be
 * looked for under that literal name on disk.
 */
export function decodeImagePath(src: string): string | null {
  const withoutFragment = src.split("#")[0].split("?")[0];
  if (!withoutFragment) return null;
  try {
    return decodeURIComponent(withoutFragment);
  } catch {
    // A malformed escape. Take it literally rather than refusing outright:
    // a file really can be called `100%.png`.
    return withoutFragment;
  }
}

/** How a resolved image should be handed back. */
export type ImageFormat = "blob" | "data";

const MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  ico: "image/x-icon",
};

function mimeFor(relPath: string): string {
  const extension = relPath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = "";
  // In chunks: spreading a multi-megabyte array into `fromCharCode` at once
  // overflows the argument list.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

/**
 * A usable URL for an image beside a document, or null when there is none.
 *
 * `blob` for the preview, where the same URL is reused across renders.
 * `data` for the HTML export, which has to carry the bytes inside the file.
 */
export async function resolveDocumentImage(
  handle: string,
  src: string,
  locale: string,
  format: ImageFormat = "blob",
): Promise<string | null> {
  const relPath = decodeImagePath(src);
  if (!relPath) return null;

  let bytes: Uint8Array | null = null;

  if (format === "blob") {
    const key = cacheKey(handle, relPath);
    const cached = cache.get(key);
    const stat = await backend.imageStat(handle, relPath, locale).catch(() => null);
    if (!stat) {
      // Gone, or never resolvable on this platform. Drop any stale copy so a
      // deleted image stops showing.
      evict(key);
      return null;
    }
    if (
      cached &&
      cached.modifiedMs === (stat.modifiedMs ?? null) &&
      cached.size === (stat.size ?? null)
    ) {
      return cached.url;
    }
    evict(key);
    bytes = await backend.readImage(handle, relPath, locale).catch(() => null);
    if (!bytes) return null;
    const blob = new Blob([bytes as BlobPart], { type: mimeFor(relPath) });
    const url = URL.createObjectURL(blob);
    makeRoom(bytes.length);
    cache.set(key, {
      url,
      bytes: bytes.length,
      modifiedMs: stat.modifiedMs ?? null,
      size: stat.size ?? null,
    });
    cachedBytes += bytes.length;
    return url;
  }

  bytes = await backend.readImage(handle, relPath, locale).catch(() => null);
  if (!bytes) return null;
  return toDataUrl(bytes, mimeFor(relPath));
}

/** Where the images of a rendered document should be looked for. */
export type ImageSource = {
  /** The open document they are relative to. */
  handle: string;
  locale: string;
  format?: ImageFormat;
};

/**
 * Point every document-relative `<img>` in a container at its real file.
 *
 * Images that already load on their own — `https:`, `data:`, `blob:` — are
 * left exactly as they are, and one that cannot be found is left alone too,
 * so it shows the browser's broken-image mark and its alt text rather than
 * disappearing.
 */
export async function resolveRelativeImages(
  container: Element,
  images: ImageSource | undefined,
  isStale?: () => boolean,
): Promise<void> {
  if (!images?.handle) return;
  const targets = [...container.querySelectorAll("img")].filter((img) =>
    isDocumentRelative(img.getAttribute("src") ?? ""),
  );
  if (targets.length === 0) return;

  await Promise.all(
    targets.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      const resolved = await resolveDocumentImage(
        images.handle,
        src,
        images.locale,
        images.format ?? "blob",
      );
      if (!resolved || isStale?.()) return;
      // Kept, so a re-render of the same document knows the original link and
      // can resolve it again rather than treating the blob URL as the source.
      img.setAttribute("data-relative-src", src);
      img.setAttribute("src", resolved);
      // And waited for: setting the source does not give the element a size,
      // and until the bytes are decoded an image is zero high. paged.js works
      // out where a page ends by measuring what is on it, so this is what
      // stops the first pagination of an illustrated document being computed
      // as though it had no pictures in it.
      //
      // Reasoned rather than measured, and worth saying so: the view
      // re-paginates on the next render either way, so the end state is the
      // same and no test here can tell the two apart. What it costs is one
      // already-resolved promise per image.
      await img.decode?.().catch(() => {
        /* a broken or unsupported file; it will show as broken, which is right */
      });
    }),
  );
}
