import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown", () => {
  it("renderiza Markdown extendido y líneas de bloques de código", () => {
    const html = renderMarkdown("# Título\n\n```ts\nconst x = 1;\n```");
    expect(html).toContain("<h1 data-line=\"0\">");
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
