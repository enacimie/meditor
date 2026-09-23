// @vitest-environment jsdom
/**
 * Compartment settings must survive a tab switch.
 *
 * Each tab keeps its own EditorState, and switching tabs calls
 * `view.setState()`, which resets every compartment to the value it was given
 * when the editor mounted. Anything driven by a prop has to be re-applied
 * afterwards, or the setting silently reverts.
 *
 * The interesting case is always the same: change a setting AFTER mounting,
 * then switch tabs. If the setting matched its mount-time value the bug is
 * invisible, because the fresh state happens to carry the right configuration.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import Editor from "./Editor";

beforeAll(() => {
  if (!("getClientRects" in (document.createTextNode("") as Node))) {
    (Range.prototype as unknown as Record<string, unknown>).getClientRects =
      function () {
        return [] as unknown as DOMRectList;
      };
  }
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** True when CodeMirror is currently wrapping long lines. */
function isWrapping(): boolean {
  return (
    document.querySelector<HTMLElement>(".cm-content")?.classList.contains(
      "cm-lineWrapping",
    ) ?? false
  );
}

function placeholderText(): string | undefined {
  return document.querySelector(".cm-placeholder")?.textContent ?? undefined;
}

const IDS = ["doc-a", "doc-b"];

/** The `lang` on the content element, or null when it has none of its own. */
function contentLanguage(): string | null {
  return document.querySelector(".cm-content")?.getAttribute("lang") ?? null;
}

type Overrides = {
  activeId?: string;
  wrap?: boolean;
  zenMode?: boolean;
  textLanguage?: string | null;
};

/** The editor as App renders it, with the props under test overridable. */
function view({
  activeId = "doc-a",
  wrap = false,
  zenMode = false,
  textLanguage = null,
}: Overrides) {
  return (
    <Editor
      activeId={activeId}
      ids={IDS}
      content=""
      onChange={vi.fn()}
      wrap={wrap}
      zenMode={zenMode}
      zenPlaceholder="Start writing..."
      kind="markdown"
      textLanguage={textLanguage}
    />
  );
}

describe("editor compartments across tab switches", () => {
  it("keeps a zen placeholder that was turned on after mount", async () => {
    // Mounted WITHOUT zen mode, so the mount-time configuration has no
    // placeholder: this is the case a fresh EditorState gets wrong.
    const { rerender } = render(view({}));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    expect(placeholderText()).toBeUndefined();

    rerender(view({ zenMode: true }));
    await waitFor(() => expect(placeholderText()).toBe("Start writing..."));

    // Switching tabs while still in zen mode must not drop it.
    rerender(view({ activeId: "doc-b", zenMode: true }));
    await waitFor(() =>
      expect(
        placeholderText(),
        "the zen placeholder must survive a tab switch",
      ).toBe("Start writing..."),
    );
  });

  it("keeps line wrapping that was turned on after mount", async () => {
    const { rerender } = render(view({ wrap: false }));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    expect(isWrapping()).toBe(false);

    rerender(view({ wrap: true }));
    await waitFor(() => expect(isWrapping()).toBe(true));

    rerender(view({ activeId: "doc-b", wrap: true }));
    await waitFor(() =>
      expect(isWrapping(), "line wrapping must survive a tab switch").toBe(true),
    );
  });

  it("keeps both settings when returning to the first tab", async () => {
    const { rerender } = render(view({}));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());

    rerender(view({ wrap: true, zenMode: true }));
    await waitFor(() => expect(isWrapping()).toBe(true));

    rerender(view({ activeId: "doc-b", wrap: true, zenMode: true }));
    await waitFor(() => expect(placeholderText()).toBe("Start writing..."));

    // Back to the tab whose state was cached before the settings changed.
    rerender(view({ activeId: "doc-a", wrap: true, zenMode: true }));
    await waitFor(() => expect(isWrapping()).toBe(true));
    expect(placeholderText()).toBe("Start writing...");
  });
});

describe("the document's language on the editor", () => {
  it("is there from the start", async () => {
    render(view({ textLanguage: "fr" }));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    expect(contentLanguage()).toBe("fr");
  });

  it("follows the document as it changes, and leaves when it is gone", async () => {
    const { rerender } = render(view({}));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    expect(contentLanguage()).toBeNull();

    rerender(view({ textLanguage: "es" }));
    await waitFor(() => expect(contentLanguage()).toBe("es"));

    // Nothing of its own, so the element inherits the interface's again.
    rerender(view({ textLanguage: null }));
    await waitFor(() => expect(contentLanguage()).toBeNull());
  });

  it("survives a tab switch that does not change it", async () => {
    // The prop is the same before and after, so only the restore that follows
    // `view.setState()` can put it back.
    const { rerender } = render(view({}));
    await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
    rerender(view({ textLanguage: "de" }));
    await waitFor(() => expect(contentLanguage()).toBe("de"));

    rerender(view({ activeId: "doc-b", textLanguage: "de" }));
    await waitFor(() =>
      expect(contentLanguage(), "the language must survive a tab switch").toBe("de"),
    );
  });
});
