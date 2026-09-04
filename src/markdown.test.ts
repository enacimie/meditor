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
