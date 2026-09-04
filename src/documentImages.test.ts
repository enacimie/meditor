// @vitest-environment jsdom
/**
 * Images a document points at with a relative path.
 *
 * The awkward part is not fetching them, it is not re-fetching them: the
 * preview renders on every keystroke, so a photograph must be read once and
 * then recognised, while a photograph edited in another program must not be
 * served from memory forever. These tests drive the backend by hand so both
 * halves can be watched.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const imageStat = vi.fn();
const readImage = vi.fn();

vi.mock("./backend", () => ({
  backend: {
    imageStat: (...args: unknown[]) => imageStat(...args),
    readImage: (...args: unknown[]) => readImage(...args),
  },
}));

const {
  isDocumentRelative,
  decodeImagePath,
  resolveDocumentImage,
  resolveRelativeImages,
  clearImageCache,
} = await import("./documentImages");

/** Object URLs jsdom does not implement, and the ones handed back. */
let created: Blob[] = [];
let revoked: string[] = [];

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      created.push(blob);
      return `blob:test/${++n}`;
    },
    revokeObjectURL: (url: string) => {
      revoked.push(url);
    },
  });
  imageStat.mockReset();
  readImage.mockReset();
  clearImageCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("isDocumentRelative", () => {
  it("accepts a path beside or under the document", () => {
    expect(isDocumentRelative("assets/shot.png")).toBe(true);
    expect(isDocumentRelative("shot.png")).toBe(true);
    expect(isDocumentRelative("./shot.png")).toBe(true);
  });

  it("accepts a path that goes up a level", () => {
    // How a folder of documents shares its pictures.
    expect(isDocumentRelative("../shared/logo.png")).toBe(true);
  });

  it("leaves alone everything the browser can already load", () => {
    for (const src of [
      "https://example.com/a.png",
      "http://example.com/a.png",
      "data:image/png;base64,AAAA",
      "blob:whatever",
      "file:///home/a.png",
      "//example.com/a.png",
      "/absolute/a.png",
    ]) {
      expect(isDocumentRelative(src), src).toBe(false);
    }
  });

  it("leaves alone a Windows path on any platform", () => {
    expect(isDocumentRelative("C:/Users/a.png")).toBe(false);
    expect(isDocumentRelative("C:\\Users\\a.png")).toBe(false);
    expect(isDocumentRelative("\\\\server\\share\\a.png")).toBe(false);
  });

  it("says no to an empty source", () => {
    expect(isDocumentRelative("")).toBe(false);
  });
});

describe("decodeImagePath", () => {
  it("undoes the escaping markdown-it applies to a link", () => {
    // Without this the file would be looked for under the literal name
    // "mi%20foto.png", which is not what is on disk.
    expect(decodeImagePath("assets/mi%20foto.png")).toBe("assets/mi foto.png");
    expect(decodeImagePath("assets/secci%C3%B3n.png")).toBe("assets/sección.png");
  });

  it("drops a fragment or a query", () => {
    expect(decodeImagePath("a.png#frag")).toBe("a.png");
    expect(decodeImagePath("a.png?v=2")).toBe("a.png");
  });

  it("takes a malformed escape literally rather than refusing", () => {
    // A file really can be called "100%.png".
    expect(decodeImagePath("100%.png")).toBe("100%.png");
  });
});

describe("resolveDocumentImage", () => {
  it("reads the file once and recognises it afterwards", async () => {
    imageStat.mockResolvedValue({ modifiedMs: 111, size: 4 });
    readImage.mockResolvedValue(PNG);

    const first = await resolveDocumentImage("h1", "assets/shot.png", "en");
    const second = await resolveDocumentImage("h1", "assets/shot.png", "en");

    expect(first).toBe("blob:test/1");
    expect(second).toBe(first);
    // Stat on both renders — that is the cheap call — but only one read.
    expect(imageStat).toHaveBeenCalledTimes(2);
    expect(readImage).toHaveBeenCalledTimes(1);
  });

  it("reads it again once the file on disk changes", async () => {
    imageStat.mockResolvedValueOnce({ modifiedMs: 111, size: 4 });
    readImage.mockResolvedValue(PNG);
    const first = await resolveDocumentImage("h1", "a.png", "en");

    // Edited in another program: same name, new fingerprint.
    imageStat.mockResolvedValueOnce({ modifiedMs: 222, size: 9 });
    readImage.mockResolvedValue(new Uint8Array([1, 2, 3]));
    const second = await resolveDocumentImage("h1", "a.png", "en");

    expect(second).not.toBe(first);
    expect(readImage).toHaveBeenCalledTimes(2);
    // The old object URL is released rather than left behind.
    expect(revoked).toContain(first);
  });

  it("gives back nothing when the image is not there", async () => {
    imageStat.mockResolvedValue(null);
    expect(await resolveDocumentImage("h1", "missing.png", "en")).toBeNull();
    expect(readImage).not.toHaveBeenCalled();
  });

  it("forgets an image that has been deleted since it was read", async () => {
    imageStat.mockResolvedValueOnce({ modifiedMs: 1, size: 4 });
    readImage.mockResolvedValue(PNG);
    const url = await resolveDocumentImage("h1", "a.png", "en");

    imageStat.mockResolvedValueOnce(null);
    expect(await resolveDocumentImage("h1", "a.png", "en")).toBeNull();
    expect(revoked).toContain(url);
  });

  it("keeps two documents' images apart", async () => {
    imageStat.mockResolvedValue({ modifiedMs: 1, size: 4 });
    readImage.mockResolvedValue(PNG);
    const a = await resolveDocumentImage("h1", "a.png", "en");
    const b = await resolveDocumentImage("h2", "a.png", "en");
    // Same relative name, different documents, different files.
    expect(b).not.toBe(a);
  });

  it("returns a data URL when the export asks for one", async () => {
    readImage.mockResolvedValue(PNG);
    const url = await resolveDocumentImage("h1", "a.png", "en", "data");
    expect(url).toBe("data:image/png;base64,iVBORw==");
    // No stat: an export reads once and is done, so there is nothing to
    // revalidate against.
    expect(imageStat).not.toHaveBeenCalled();
  });

  it("survives a backend that rejects", async () => {
    imageStat.mockRejectedValue(new Error("no"));
    expect(await resolveDocumentImage("h1", "a.png", "en")).toBeNull();
  });
});

describe("resolveRelativeImages", () => {
  /** A container with the given image sources. */
  const host = (...srcs: string[]) => {
    const el = document.createElement("div");
    el.innerHTML = srcs.map((s) => `<img src="${s}" alt="x">`).join("");
    return el;
  };

  const src = (el: Element, i = 0) =>
    el.querySelectorAll("img")[i].getAttribute("src");

  it("points a relative image at its real file", async () => {
    imageStat.mockResolvedValue({ modifiedMs: 1, size: 4 });
    readImage.mockResolvedValue(PNG);
    const el = host("assets/shot.png");

    await resolveRelativeImages(el, { handle: "h1", locale: "en" });

    expect(src(el)).toBe("blob:test/1");
    // The original link is kept, so a later render resolves the file again
    // rather than treating the blob URL as the source.
    expect(el.querySelector("img")!.getAttribute("data-relative-src")).toBe(
      "assets/shot.png",
    );
  });

  it("leaves a remote or embedded image exactly as it is", async () => {
    const el = host("https://example.com/a.png", "data:image/png;base64,AAAA");
    await resolveRelativeImages(el, { handle: "h1", locale: "en" });
    expect(src(el, 0)).toBe("https://example.com/a.png");
    expect(src(el, 1)).toBe("data:image/png;base64,AAAA");
    expect(imageStat).not.toHaveBeenCalled();
  });

  it("leaves an image it cannot find alone, so it shows as broken", async () => {
    // Blanking the src would hide the fact that the document asks for a
    // picture; the browser's broken-image mark and the alt text say so.
    imageStat.mockResolvedValue(null);
    const el = host("assets/missing.png");
    await resolveRelativeImages(el, { handle: "h1", locale: "en" });
    expect(src(el)).toBe("assets/missing.png");
  });

  it("does nothing for a document with no handle", async () => {
    const el = host("assets/shot.png");
    await resolveRelativeImages(el, undefined);
    expect(src(el)).toBe("assets/shot.png");
    expect(imageStat).not.toHaveBeenCalled();
  });

  it("does not touch a render that has been superseded", async () => {
    // The user kept typing while the bytes were in flight; this container is
    // about to be thrown away and writing to it would fight the new one.
    imageStat.mockResolvedValue({ modifiedMs: 1, size: 4 });
    readImage.mockResolvedValue(PNG);
    const el = host("assets/shot.png");
    await resolveRelativeImages(el, { handle: "h1", locale: "en" }, () => true);
    expect(src(el)).toBe("assets/shot.png");
  });
});
