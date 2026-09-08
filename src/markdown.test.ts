import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renderiza Markdown extendido y líneas de bloques de código", () => {
    const html = renderMarkdown("# Título\n\n```ts\nconst x = 1;\n```");
    // El título lleva además su identificador, así que la comprobación es
    // sobre el atributo y no sobre la etiqueta entera: lo que importa aquí es
    // que el número de línea llega, no en qué orden se escriben los atributos.
    expect(html).toMatch(/<h1[^>]*\sdata-line="0"/);
    expect(html).toContain("<pre data-line=\"2\">");
    expect(html).toContain("const");
  });

  it("no interpreta HTML embebido", () => {
    const html = renderMarkdown("<script>alert(1)</script>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("soporta matemáticas, tareas y contenedores", () => {
    const html = renderMarkdown("- [x] Hecho\n\n$e^{i\\pi}+1=0$\n\n::: note\nAviso\n:::");
    expect(html).toContain("task-list-item");
    expect(html).toContain("katex");
    expect(html).toContain("note");
  });

  it("resalta lenguajes comunes con el registro reducido", () => {
    const html = renderMarkdown("```typescript\nconst answer: number = 42;\n```");
    expect(html).toContain("language-typescript");
    expect(html).toContain("hljs-keyword");
  });

  it("resalta los nuevos lenguajes añadidos (C, C++, Java, Go, Ruby, YAML, Dockerfile)", () => {
    const html = renderMarkdown(
      "```c\n#include <stdio.h>\nint main() { return 0; }\n```\n\n" +
      "```go\npackage main\nimport \"fmt\"\nfunc main() { fmt.Println(\"hi\") }\n```\n\n" +
      "```yaml\nname: test\nversion: 1\n```\n\n" +
      "```dockerfile\nFROM alpine:latest\nRUN echo hello\n```"
    );
    expect(html).toContain("language-c");
    expect(html).toContain("language-go");
    expect(html).toContain("language-yaml");
    expect(html).toContain("language-dockerfile");
    // C++ alias (class reflects user tag, not canonical name)
    const cppHtml = renderMarkdown("```c++\nclass Foo {};\n```");
    expect(cppHtml).toContain("language-c++");
    // Also test canonical cpp tag
    const cppCanonical = renderMarkdown("```cpp\nclass Bar {};\n```");
    expect(cppCanonical).toContain("language-cpp");
  });
});

describe("párrafos que abren con un número en negrita", () => {
  /*
   * `**1.** Texto` no es una lista para Markdown y no puede serlo: el marcador
   * es `1.` seguido de espacio, y envolverlo en asteriscos lo vuelve énfasis.
   * Pero es como se numeran a mano los párrafos que llevan otros párrafos
   * intercalados —respuestas, notas—, y con la sangría de prosa el primero
   * quedaba desalineado de sus hermanos por ser el único sin párrafo encima
   * del que sangrarse. Se marcan aquí para darles en la vista de documento la
   * misma geometría que una lista.
   */

  it("marca el párrafo que abre con un número en negrita", () => {
    expect(renderMarkdown("**1.** Primer punto\n")).toContain("numbered-paragraph");
  });

  it("lo marca también cuando no es el primero del documento", () => {
    // El caso que motivó todo: el primero se veía distinto de los demás, así
    // que todos han de quedar marcados igual, estén donde estén.
    const html = renderMarkdown("**1.** Uno\n\n—respuesta\n\n**2.** Dos\n");
    expect(html.match(/numbered-paragraph/g)).toHaveLength(2);
  });

  it("acepta la forma con paréntesis", () => {
    expect(renderMarkdown("**1)** Primer punto\n")).toContain("numbered-paragraph");
  });

  it("deja en paz un párrafo que abre con un año en negrita", () => {
    // El falso positivo que saldría caro: prosa que empieza citando un año
    // pasaría a sangrarse como si fuera el punto de una enumeración.
    expect(renderMarkdown("**2024.** Fue un año complicado\n")).not.toContain(
      "numbered-paragraph",
    );
  });

  it("deja en paz la negrita que no abre el párrafo", () => {
    expect(renderMarkdown("Como decía **1.** ayer\n")).not.toContain("numbered-paragraph");
  });

  it("deja en paz la negrita que no es un número", () => {
    expect(renderMarkdown("**Nota.** Un aviso cualquiera\n")).not.toContain(
      "numbered-paragraph",
    );
  });

  it("no toca una lista de verdad", () => {
    const html = renderMarkdown("1. Uno\n2. Dos\n");
    expect(html).toContain("<ol");
    expect(html).not.toContain("numbered-paragraph");
  });

  it("conserva el número de línea del párrafo", () => {
    // La clase se añade sobre el mismo token que lleva `data-line`; perderlo
    // rompería el salto entre la vista previa y el editor.
    expect(renderMarkdown("# T\n\n**1.** Uno\n")).toContain('data-line="2"');
  });
});

describe("identificadores en los títulos", () => {
  /*
   * `[texto](#un-titulo)` es Markdown corriente y funciona allá donde el
   * documento se publique, pero aquí no llevaba a ninguna parte: ningún
   * título tenía id, así que el enlace no encontraba destino y el clic no
   * hacía nada. El esquema lateral ya sabía saltar; un enlace escrito dentro
   * de la prosa, no.
   */

  /** El valor del atributo `id` de cada título del HTML, en orden. */
  const ids = (markdown: string): string[] =>
    [...renderMarkdown(markdown).matchAll(/<h[1-6][^>]*\sid="([^"]*)"/g)].map((m) => m[1]);

  it("da a cada título un identificador a partir de su texto", () => {
    expect(ids("# Primer título\n\n## Segundo\n")).toEqual([
      "primer-título",
      "segundo",
    ]);
  });

  it("conserva las letras que no son ASCII", () => {
    // Sin esto, un documento en español, griego o árabe tendría todos sus
    // títulos colapsados al mismo identificador vacío. GitHub también las
    // conserva, y es contra GitHub contra lo que la gente ya ha escrito sus
    // enlaces.
    expect(ids("## Sección\n")).toEqual(["sección"]);
    expect(ids("## Ελλάδα\n")).toEqual(["ελλάδα"]);
  });

  it("quita la puntuación y une las palabras con guiones", () => {
    expect(ids("## ¿Qué es esto, exactamente?\n")).toEqual(["qué-es-esto-exactamente"]);
  });

  it("numera los títulos que se repiten para que ambos sean alcanzables", () => {
    expect(ids("## Notas\n\n## Notas\n\n## Notas\n")).toEqual([
      "notas",
      "notas-1",
      "notas-2",
    ]);
  });

  it("toma el texto que se lee, no los signos del formato", () => {
    // El id se calcula sobre las palabras visibles: el énfasis y el código
    // en línea no forman parte del título tal y como se lee.
    expect(ids("## Usar **negrita** y `código`\n")).toEqual([
      "usar-negrita-y-código",
    ]);
  });

  it("no mete la dirección de un enlace dentro del identificador", () => {
    // El caso que separa mirar los hijos del token de mirar la fuente en
    // crudo: en crudo la URL forma parte del texto y el identificador sale
    // como `ver-la-documentaciónhttpsejemplocomdocs`, que no es lo que nadie
    // escribiría en un enlace ni lo que genera GitHub.
    expect(ids("## Ver [la documentación](https://ejemplo.com/docs)\n")).toEqual([
      "ver-la-documentación",
    ]);
  });

  it("no le quita a una nota al pie su destino", () => {
    // El plugin de notas es dueño de `fn1` y `fnref1`. Un título que generase
    // ese mismo id pondría dos elementos bajo él y se quedaría con el sitio
    // al que vuelve el enlace de la nota.
    const html = renderMarkdown("## fn1\n\nTexto[^1]\n\n[^1]: La nota\n");
    expect(html).toContain('id="fn1-heading"');
    expect(html.match(/id="fn1"/g)).toHaveLength(1);
  });

  it("deja sin id un título que no da ninguna letra ni número", () => {
    // Un identificador vacío no lleva a ningún sitio y chocaría con el
    // siguiente título igual de vacío.
    expect(ids("## ***\n")).toEqual([]);
  });

  it("conserva el número de línea del título", () => {
    // El id se añade sobre el mismo token que lleva `data-line`; perderlo
    // rompería el salto entre la vista previa y el editor.
    expect(renderMarkdown("# T\n\n## Otro\n")).toContain('data-line="2"');

  });
});

describe("front-matter YAML", () => {
  /*
   * Un bloque de `clave: valor` entre `---` al principio del fichero es cómo
   * Hugo, Jekyll, Pandoc, Obsidian y Zettlr guardan el título, el autor y la
   * fecha de un documento. Markdown no sabe qué es: el `---` de arriba se
   * lee como línea horizontal y lo de debajo como un título subrayado, así
   * que el bloque entero acababa en la vista previa —y en el PDF— como una
   * raya seguida del YAML en crudo y en cuerpo de encabezado.
   */

  it("no renderiza el bloque de metadatos", () => {
    const html = renderMarkdown("---\ntitle: Mi documento\nauthor: Alguien\n---\n\n# Encabezado\n");
    expect(html).not.toContain("title:");
    expect(html).not.toContain("author:");
    expect(html).not.toContain("<hr>");
    expect(html).toContain("<h1");
  });

  it("acepta el cierre con puntos suspensivos de YAML", () => {
    expect(renderMarkdown("---\ntitle: X\n...\n\n# H\n")).not.toContain("title:");
  });

  it("acepta un comentario antes de la primera clave", () => {
    expect(renderMarkdown("---\n# nota\ntitle: X\n---\n\n# H\n")).not.toContain("title:");
  });

  it("conserva los números de línea de lo que viene después", () => {
    // Si se perdieran, el salto entre la vista previa y el editor llevaría a
    // la línea equivocada en todo documento con metadatos.
    const html = renderMarkdown("---\ntitle: X\n---\n\n# Encabezado\n\nTexto.\n");
    expect(html).toContain('data-line="4"');
    expect(html).toContain('data-line="6"');
  });

  it("no se traga el texto entre dos rayas decorativas", () => {
    // El caso que costaría caro: un documento que abre con una línea
    // horizontal, lleva un párrafo y vuelve a rayar. Las dos rayas son
    // idénticas a una valla de metadatos, y sin la comprobación de que lo
    // de dentro parece YAML el párrafo desaparecía de la vista.
    const html = renderMarkdown("---\n\nTexto importante\n\n---\n\n# H\n");
    expect(html).toContain("Texto importante");
    expect(html.match(/<hr>/g)).toHaveLength(2);
  });

  it("deja en paz una valla que no llega a cerrarse", () => {
    const html = renderMarkdown("---\ntitle: X\n\n# H\n");
    expect(html).toContain("title:");
  });

  it("deja en paz una raya que no abre el documento", () => {
    const html = renderMarkdown("Párrafo\n\n---\n\n# H\n");
    expect(html).toContain("<hr>");
    expect(html).toContain("Párrafo");
  });

  it("no confunde con metadatos una valla a mitad del documento", () => {
    // Los metadatos van arriba, por definición. Un par de rayas más abajo con
    // algo que lleve dos puntos dentro —una nota, una cita atribuida— tiene la
    // forma exacta de una valla, y sin exigir que abra el fichero ese texto
    // se perdería.
    const html = renderMarkdown("Intro\n\n---\nNota: esto importa\n---\n\n# H\n");
    expect(html).toContain("Nota: esto importa");
  });

  it("deja en paz una valla sangrada", () => {
    // Sangrada es un bloque de código, no metadatos.
    expect(renderMarkdown("  ---\ntitle: X\n---\n\n# H\n")).toContain("title:");
  });

  it("sigue ocultando el front-matter de un documento Marp", () => {
    // `marp: true` se lee aparte, sobre la fuente, y no depende de esto —
    // pero el bloque tampoco ha de verse cuando se renderiza como Markdown.
    expect(renderMarkdown("---\nmarp: true\n---\n\n# H\n")).not.toContain("marp:");
  });
});

describe("the [TOC] marker", () => {
  it("lists the headings, linked to the ids they actually have", () => {
    const html = renderMarkdown(
      ["[TOC]", "", "# Uno", "", "## Detalle", "", "# Dos", ""].join("\n"),
    );
    expect(html).toContain('<nav class="markdown-toc" role="doc-toc">');
    expect(html).toContain('<a href="#uno">Uno</a>');
    expect(html).toContain('<a href="#detalle">Detalle</a>');
    expect(html).toContain('<a href="#dos">Dos</a>');
  });

  it("follows the suffix a repeated title gets, rather than guessing", () => {
    // The link and the heading come from the same ids, so the second "Notas"
    // is reachable instead of both entries landing on the first.
    const html = renderMarkdown(["[TOC]", "", "# Notas", "", "# Notas", ""].join("\n"));
    expect(html).toContain('<a href="#notas">Notas</a>');
    expect(html).toContain('<a href="#notas-1">Notas</a>');
  });

  it("keeps the level, so the list can be indented", () => {
    const html = renderMarkdown(["[TOC]", "", "# Uno", "", "### Hondo", ""].join("\n"));
    expect(html).toContain('class="toc-item toc-level-1"');
    expect(html).toContain('class="toc-item toc-level-3"');
  });

  it("stops at the third level", () => {
    const html = renderMarkdown(["[TOC]", "", "### Tres", "", "#### Cuatro", ""].join("\n"));
    // Scoped to the nav: the h4 itself is still in the document, and looking
    // for its text anywhere would pass whatever the list contained.
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(nav).toContain(">Tres<");
    expect(nav).not.toContain(">Cuatro<");
  });

  it("renders nothing when the document has no headings", () => {
    const html = renderMarkdown(["[TOC]", "", "Just prose.", ""].join("\n"));
    expect(html).not.toContain("markdown-toc");
    expect(html).not.toContain("[TOC]");
  });

  it("takes the marker in either case, and only on a line of its own", () => {
    expect(renderMarkdown(["[toc]", "", "# H", ""].join("\n"))).toContain("markdown-toc");
    // Prose that mentions it is prose.
    const prose = renderMarkdown(["See [TOC] below.", "", "# H", ""].join("\n"));
    expect(prose).not.toContain("markdown-toc");
    expect(prose).toContain("[TOC]");
  });

  it("is a code block when it is indented like one", () => {
    const html = renderMarkdown(["    [TOC]", "", "# H", ""].join("\n"));
    expect(html).not.toContain("markdown-toc");
    expect(html).toContain("<pre><code");
  });

  it("escapes a title rather than letting it write markup", () => {
    const html = renderMarkdown(["[TOC]", "", "# a <img> & b", ""].join("\n"));
    // Inside the nav. Looking at the whole document would find the escaped
    // text in the heading markdown-it already escaped, and pass whatever the
    // link contained.
    const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
    expect(nav).toContain("a &lt;img&gt; &amp; b");
    expect(nav).not.toContain("<img>");
  });
});

describe("an explicit page break", () => {
  it("takes Typora's div, and keeps it out of the HTML it came from", () => {
    const html = renderMarkdown(
      ["Antes.", "", '<div style="page-break-after: always;"></div>', "", "Después.", ""].join(
        "\n",
      ),
    );
    expect(html).toMatch(/<div class="page-break" data-line="2"><\/div>/);
    // The marker is matched, never parsed: `html: false` stays false, so a
    // document that reaches here full of raw markup gains nothing from it.
    expect(html).not.toContain("style=");
  });

  it("takes the same div written for page-break-before", () => {
    const html = renderMarkdown('<div style="page-break-before: always;"></div>');
    expect(html).toContain('<div class="page-break"');
  });

  it("takes a bare backslash-newpage, because it is what people type", () => {
    const html = renderMarkdown(["Antes.", "", "\\newpage", "", "Después.", ""].join("\n"));
    expect(html).toMatch(/<div class="page-break" data-line="2"><\/div>/);
  });

  it("carries the line, so a double-click in the preview lands on it", () => {
    const html = renderMarkdown(["# Uno", "", "\\newpage", "", "# Dos", ""].join("\n"));
    expect(html).toContain('data-line="2"');
  });

  it("leaves anything with company on the line as prose", () => {
    // The whole point of the marker being a line rather than a token: a
    // sentence that mentions it must read as a sentence.
    const html = renderMarkdown("Escribe \\newpage para saltar de página.");
    expect(html).not.toContain("page-break");
    expect(html).toContain("newpage");
  });

  it("leaves an indented one alone, because four spaces are a code block", () => {
    const html = renderMarkdown("    \\newpage");
    expect(html).toContain("<pre");
    expect(html).not.toContain('class="page-break"');
  });

  it("does not fall for a div that asks for something else", () => {
    const html = renderMarkdown('<div style="page-break-after: avoid;"></div>');
    expect(html).not.toContain('class="page-break"');
  });
});

describe("a title block from the front-matter", () => {
  const withMeta = (lines: string[], body = "# Capítulo uno") =>
    renderMarkdown(["---", ...lines, "---", "", body, ""].join("\n"));

  it("prints the title, the author and the date, in that order", () => {
    const html = withMeta(["title: Informe anual", "author: Eduardo", "date: 2026-09-08"]);
    expect(html).toContain('<header class="doc-title-block"');
    expect(html).toMatch(
      /<h1 class="doc-title running-head">Informe anual<\/h1><p class="doc-author">Eduardo<\/p><p class="doc-date">2026-09-08<\/p>/,
    );
  });

  it("prints only what is there", () => {
    const html = withMeta(["author: Eduardo"]);
    expect(html).toContain('class="doc-author"');
    // The elements, not substrings of them: `class="doc-title-block"` starts
    // with `class="doc-title`, so anything looser fails for the wrong reason.
    expect(html).not.toMatch(/<h1[^>]*class="doc-title/);
    expect(html).not.toMatch(/<p[^>]*class="doc-date"/);
  });

  it("leaves the chapters feeding the head when there is an author but no title", () => {
    // Only a title takes the head over. An author alone says who wrote the
    // document, not what it is called.
    const html = withMeta(["author: Eduardo"]);
    expect(html).toMatch(/<h1[^>]*class="[^"]*running-head/);
  });

  it("escapes the values, which come from a file like any other text", () => {
    const html = withMeta(['title: "<script>alert(1)</script>"']);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("leaves front-matter with none of the three as invisible as it was", () => {
    const html = withMeta(["marp: true"]);
    expect(html).not.toContain("doc-title-block");
    expect(html).not.toContain("marp");
  });

  it("keeps the rest of the block out of the document", () => {
    const html = withMeta(["title: Informe", "marp: true", "transition: fade"]);
    expect(html).toContain("Informe");
    expect(html).not.toContain("transition");
    expect(html).not.toContain("marp");
  });

  it("does not read a title out of an unclosed fence", () => {
    // Which is a horizontal rule followed by prose, and has always rendered
    // as one.
    const html = renderMarkdown("---\ntitle: No es front-matter\n\n# Cuerpo");
    expect(html).not.toContain("doc-title-block");
  });
});

describe("who feeds the running head", () => {
  it("is the title block, when the document has a title", () => {
    const html = renderMarkdown(
      ["---", "title: Informe", "---", "", "# Capítulo uno", "", "# Capítulo dos", ""].join("\n"),
    );
    expect(html).toContain('<h1 class="doc-title running-head">Informe</h1>');
    // The chapters must not also answer to it: paged.js takes the last match
    // on the page, so a marked chapter heading would quietly replace the name
    // of the document.
    const chapters = html.match(/<h1[^>]*>Capítulo/g) ?? [];
    expect(chapters).toHaveLength(2);
    expect(chapters.every((tag) => !tag.includes("running-head"))).toBe(true);
  });

  it("is every h1, when it does not", () => {
    const html = renderMarkdown(["# Capítulo uno", "", "# Capítulo dos", ""].join("\n"));
    const chapters = html.match(/<h1[^>]*>/g) ?? [];
    expect(chapters).toHaveLength(2);
    expect(chapters.every((tag) => tag.includes("running-head"))).toBe(true);
  });

  it("keeps the heading ids it already had", () => {
    // Marking a heading must not cost it its anchor, which is what the TOC and
    // every in-document link point at.
    //
    // The rule uses `attrJoin` rather than `attrSet`, but this test does not
    // prove that and no test can today: nothing else puts a class on an `h1`,
    // so the two behave identically. `attrJoin` is there for whatever does
    // next, not for something being guarded now.
    const html = renderMarkdown("# Capítulo uno");
    expect(html).toMatch(/<h1[^>]*id="capítulo-uno"/);
    expect(html).toMatch(/<h1[^>]*class="[^"]*running-head/);
  });
});

describe("an image alone in its paragraph is a figure", () => {
  it("wraps it, captions it from the title, and numbers it", () => {
    const html = renderMarkdown('![Un gato](gato.png "Un gato al sol")');
    expect(html).toMatch(/<figure[^>]*class="[^"]*figure"/);
    expect(html).toContain("<figcaption>");
    expect(html).toContain('<span class="figure-label">Figure 1.</span> Un gato al sol');
  });

  it("leaves an image with alt text but no title as an image", () => {
    // Pandoc promotes this one and meditor deliberately does not. Alt text is
    // an accessibility description that people write for every image; taking
    // it as a caption would number every screenshot in every document that
    // already exists.
    const html = renderMarkdown("![Un gato al sol](gato.png)");
    expect(html).not.toContain("<figure");
    expect(html).toContain('alt="Un gato al sol"');
  });

  it("numbers them in the order they appear", () => {
    const html = renderMarkdown(
      '![a](a.png "Uno")\n\n![b](b.png "Dos")\n\n![c](c.png "Tres")\n',
    );
    const labels = [...html.matchAll(/class="figure-label">([^<]*)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Figure 1.", "Figure 2.", "Figure 3."]);
  });

  it("takes the label from the caller, so it reads in the document's language", () => {
    const html = renderMarkdown('![Un gato](gato.png "Al sol")', {
      figureLabel: (n) => `Figura ${n}.`,
    });
    expect(html).toContain("Figura 1.");
    expect(html).not.toContain("Figure 1.");
  });

  it("leaves an image with company in the paragraph alone", () => {
    // An image mentioned mid-sentence is not being presented; it is being
    // used. Numbering it would number the sentence.
    const html = renderMarkdown('Mira ![este gato](gato.png "Al sol") de cerca.');
    expect(html).not.toContain("<figure");
    expect(html).toContain("<img");
  });

  it("leaves it alone when the image opens the paragraph and text follows", () => {
    // The case that separates "the only child" from "the first child". With
    // the looser check this reads as a figure and swallows the sentence after
    // it into the caption's paragraph.
    const html = renderMarkdown('![Un gato](gato.png "Al sol") y a su lado la ventana.');
    expect(html).not.toContain("<figure");
    expect(html).toContain("y a su lado la ventana");
  });

  it("leaves an image with nothing to say alone", () => {
    // No title and no alt: a label over nothing.
    const html = renderMarkdown("![](gato.png)");
    expect(html).not.toContain("<figure");
    expect(html).not.toContain("figure-label");
  });

  it("does not number an image it did not turn into a figure", () => {
    // The uncaptioned one is skipped entirely, so the captioned one below it
    // is still Figure 1 — the count follows the figures, not the images.
    const html = renderMarkdown('![sin pie](sin-pie.png)\n\n![alt](otro.png "Con pie")\n');
    const labels = [...html.matchAll(/class="figure-label">([^<]*)</g)].map((m) => m[1]);
    expect(labels).toEqual(["Figure 1."]);
  });

  it("escapes the caption, which comes from a file like any other text", () => {
    const html = renderMarkdown('![alt](x.png "<script>alert(1)</script>")');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("keeps the line, so a double-click on the figure finds its source", () => {
    const html = renderMarkdown('# Título\n\n![Un gato](gato.png "Al sol")\n');
    expect(html).toMatch(/<figure[^>]*data-line="2"/);
  });

  it("keeps the image itself, alt and all", () => {
    const html = renderMarkdown('![Un gato](gato.png "Al sol")');
    expect(html).toContain('src="gato.png"');
    expect(html).toContain('alt="Un gato"');
  });
});
