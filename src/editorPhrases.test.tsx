// @vitest-environment jsdom
/**
 * CodeMirror's own words in the interface language.
 *
 * The find panel, "Go to line", the fold markers and the screen-reader
 * announcements are written by CodeMirror, not by meditor, so the app's
 * translations never reached them: with the interface in Spanish the find
 * panel still said "Find", "next", "replace all".
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { openSearchPanel, closeSearchPanel, gotoLine } from "@codemirror/search";
// @ts-expect-error node:fs carries no types here: the src project is kept
// DOM-only on purpose, and vite.config.ts reaches for Node the same way.
import { readFileSync } from "node:fs";
// @ts-expect-error node:module, likewise.
import { createRequire } from "node:module";
import Editor from "./Editor";
import { EDITOR_PHRASES } from "./editorPhrases";
import { I18nProvider, useTranslation } from "./i18n/I18nProvider";
import { translations, type Language } from "./i18n/translations";

const LANG_KEY = "meditor.language.v1";

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
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Every string an installed CodeMirror package hands to `phrase()`.
 *
 * Read from the code itself, so the list in editorPhrases.ts cannot fall
 * behind an upgrade unnoticed. The six packages are the ones that call it;
 * each must still yield something, or a rename would make this pass on an
 * empty set.
 */
function phrasesInCodeMirror(): Set<string> {
  const fromCodeMirror = createRequire(createRequire(import.meta.url).resolve("codemirror"));
  const found = new Set<string>();
  for (const name of ["search", "language", "commands", "view", "autocomplete", "lint"]) {
    const source: string = readFileSync(fromCodeMirror.resolve(`@codemirror/${name}`), "utf8");
    let count = 0;
    for (const call of source.matchAll(/phrase\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
      for (const literal of call[1].matchAll(/"([^"]+)"/g)) {
        found.add(literal[1]);
        count++;
      }
    }
    expect(count, `@codemirror/${name} no longer calls phrase() the way this reads it`).toBeGreaterThan(0);
  }
  return found;
}

describe("the phrase list", () => {
  it("covers every phrase CodeMirror asks for, and nothing it does not", () => {
    expect(new Set(Object.keys(EDITOR_PHRASES))).toEqual(phrasesInCodeMirror());
  });

  it("leaves English exactly as CodeMirror writes it", () => {
    const en = translations.en as Record<string, unknown>;
    for (const [phrase, key] of Object.entries(EDITOR_PHRASES)) {
      expect(en[key], key).toBe(phrase);
    }
  });

  it("keeps the $ that CodeMirror fills with a number, in every language", () => {
    const withNumber = Object.entries(EDITOR_PHRASES).filter(([phrase]) => phrase.includes("$"));
    expect(withNumber.length).toBeGreaterThan(0);
    for (const lang of Object.keys(translations) as Language[]) {
      const dict = translations[lang] as Record<string, unknown>;
      for (const [, key] of withNumber) {
        const value = dict[key];
        if (value === undefined) continue;
        expect(String(value).split("$").length - 1, `${lang}.${key}`).toBe(1);
      }
    }
  });
});

/** Lets a test change the interface language the way the language picker does. */
function LanguageSwitch() {
  const { setLanguage } = useTranslation();
  return (
    <button type="button" className="switch-to-es" onClick={() => setLanguage("es")}>
      es
    </button>
  );
}

function tree(activeId: string) {
  return (
    <I18nProvider>
      <LanguageSwitch />
      <Editor
        activeId={activeId}
        ids={["doc-a", "doc-b"]}
        content="# hello"
        onChange={vi.fn()}
        wrap={false}
        kind="markdown"
      />
    </I18nProvider>
  );
}

async function mount(lang: Language, activeId = "doc-a") {
  localStorage.setItem(LANG_KEY, lang);
  const result = render(tree(activeId));
  await waitFor(() => expect(document.querySelector(".cm-editor")).toBeTruthy());
  const view = () => EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
  return { ...result, view };
}

/** What the open find panel says: its field and its buttons. */
function findPanelWords() {
  const panel = document.querySelector(".cm-search")!;
  return {
    field: panel.querySelector<HTMLInputElement>("input[name=search]")!.placeholder,
    buttons: [...panel.querySelectorAll("button")].map((b) => b.textContent),
  };
}

describe("the editor", () => {
  it("writes the find panel and Go to line in the interface language", async () => {
    const { view } = await mount("es");

    openSearchPanel(view());
    const words = findPanelWords();
    expect(words.field).toBe("Buscar");
    expect(words.buttons).toEqual(
      expect.arrayContaining(["siguiente", "anterior", "todas", "reemplazar", "reemplazar todas"]),
    );
    closeSearchPanel(view());

    gotoLine(view());
    const dialog = document.querySelector(".cm-dialog")!;
    expect(dialog.querySelector("label")!.textContent).toContain("Ir a línea");
    expect(dialog.querySelector("button[type=submit]")!.textContent).toBe("ir");
    expect(dialog.querySelector(".cm-dialog-close")!.getAttribute("aria-label")).toBe("cerrar");
  });

  it("follows a change of language without being rebuilt", async () => {
    const { view } = await mount("en");
    const before = view();

    openSearchPanel(view());
    expect(findPanelWords().field).toBe("Find");
    closeSearchPanel(view());

    fireEvent.click(document.querySelector(".switch-to-es")!);
    await waitFor(() => expect(document.documentElement.lang).toBe("es"));

    openSearchPanel(view());
    expect(findPanelWords().field).toBe("Buscar");
    expect(view()).toBe(before);
  });

  it("keeps the new language after a tab switch", async () => {
    // A tab switch swaps the whole editor state, which puts every compartment
    // back to what it held at mount: English, here.
    const { view, rerender } = await mount("en");
    fireEvent.click(document.querySelector(".switch-to-es")!);
    await waitFor(() => expect(document.documentElement.lang).toBe("es"));

    rerender(tree("doc-b"));
    openSearchPanel(view());
    expect(findPanelWords().field).toBe("Buscar");
  });
});
