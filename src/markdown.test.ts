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
