// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { pdfOutline } from "./pdfOutline";

/** Where an element is on screen: only its top and height matter here. */
function place(el: Element, top: number, height = 0): void {
  el.getBoundingClientRect = () =>
    ({ top, height, bottom: top + height, left: 0, right: 0, width: 0, x: 0, y: top }) as DOMRect;
}

/**
 * The paged view as paged.js leaves it: page boxes 1000 px tall, 100 px
 * apart, each with a running head in its top margin and its content area.
 * jsdom lays nothing out, so every heading is placed by its `data-y`, down
 * the whole view.
 */
function pagedView(...pages: string[]): HTMLElement {
  const view = document.createElement("div");
  view.className = "paged-view";
  pages.forEach((content, index) => {
    const page = document.createElement("div");
    page.className = "pagedjs_page";
    page.innerHTML =
      '<div class="pagedjs_margin-top"><h1 data-y="0">Cabecera</h1></div>' +
      `<div class="pagedjs_page_content">${content}</div>`;
    place(page, index * 1100, 1000);
    view.append(page);
  });
  for (const heading of view.querySelectorAll<HTMLElement>("[data-y]")) {
    place(heading, Number(heading.dataset.y));
  }
  return view;
}

describe("pdfOutline", () => {
  it("reads each heading on the pages with its level, its page and how far down it starts", () => {
    const view = pagedView(
      '<h1 data-y="80">Informe</h1><h1 data-y="250">Primero</h1><h2 data-y="780">Uno</h2>',
      '<h1 data-y="1680">Segundo</h1><p>Texto.</p><h3 data-y="1380">Detalle</h3>',
    );
    expect(pdfOutline(view)).toEqual([
      { level: 1, title: "Informe", page: 0, top: 0.08 },
      { level: 1, title: "Primero", page: 0, top: 0.25 },
      { level: 2, title: "Uno", page: 0, top: 0.78 },
      { level: 1, title: "Segundo", page: 1, top: 0.58 },
      { level: 3, title: "Detalle", page: 1, top: 0.28 },
    ]);
  });

  it("leaves the page margins out: the running head is not one of the document's headings", () => {
    const titles = pdfOutline(pagedView('<h1 data-y="100">Uno</h1>')).map((entry) => entry.title);
    expect(titles).toEqual(["Uno"]);
  });

  it("drops the footnote calls from a heading's text", () => {
    const view = pagedView(
      '<h2 data-y="100">Método<sup class="footnote-ref"><a href="#fn1">1</a></sup></h2>' +
        '<h2 data-y="200">Datos<span class="footnote">Una nota.</span> y   resultados</h2>',
    );
    expect(pdfOutline(view).map((entry) => entry.title)).toEqual(["Método", "Datos y resultados"]);
  });

  it("counts a heading paged.js split across two pages once, where it starts", () => {
    const view = pagedView(
      '<h2 data-y="900" data-split-to="h">Un título que no cabe</h2>',
      '<h2 data-y="1100" data-split-from="h">en su página</h2>',
    );
    expect(pdfOutline(view)).toEqual([
      { level: 2, title: "Un título que no cabe", page: 0, top: 0.9 },
    ]);
  });

  it("leaves out a heading with no text", () => {
    const view = pagedView('<h2 data-y="100"> <img alt=""> </h2><h2 data-y="200">Uno</h2>');
    expect(pdfOutline(view).map((entry) => entry.title)).toEqual(["Uno"]);
  });

  it("keeps a heading laid out past its page's box within it", () => {
    const view = pagedView('<h2 data-y="-50">Arriba</h2><h2 data-y="1050">Abajo</h2>');
    expect(pdfOutline(view).map((entry) => entry.top)).toEqual([0, 1]);
  });

  it("has nothing to say without pages", () => {
    expect(pdfOutline(document.createElement("div"))).toEqual([]);
  });
});
