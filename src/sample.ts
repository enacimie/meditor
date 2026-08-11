export const SAMPLE = `# meditor

A **Markdown** editor with _live_ preview, ==highlighted== text, and ++inserted++ annotations.

## Typography

- **Bold**, _italic_, ~~strikethrough~~, \`inline code\`
- H~2~O and E=mc^2^ (sub/superscript)
- Emoji support: :tada: :rocket: :memo: :bulb:
- Smart quotes, dashes, and ellipsis

## Links & References

- [External link](https://example.com)
- Autolink: https://example.org
- Footnotes work too[^1].

[^1]: This is a footnote. It appears at the bottom of the document.

## Tables

| Feature | Status | Priority |
| ------- | ------ | -------- |
| Markdown | Done | High |
| Mermaid | Done | High |
| KaTeX | Done | Medium |
| Export PDF | Done | Medium |

## Task Lists

- [x] Implement core editor
- [x] Add live preview
- [x] Mermaid diagrams
- [x] KaTeX math
- [ ] Typst support (phase 2)
- [ ] Collaborative editing

## Definition Lists

Tauri
: Framework for building desktop apps with web technologies.

CodeMirror
: Extensible code editor component for the web.

## Abbreviations

*[MD]: Markdown
*[HTML]: HyperText Markup Language

The MD editor supports HTML abbreviations.

## Custom Containers

::: warning
Be careful when editing large documents — auto-save is enabled by default.
:::

::: note
Pro tip: Use **Ctrl+Shift+S** to save a copy, and **Ctrl+E** to export as PDF.
:::

## Mathematics (KaTeX)

Inline math: $e^{i\\\\pi} + 1 = 0$ (Euler's identity).

Display math:

$$
\\\\int_{-\\\\infty}^{\\\\infty} e^{-x^2}\\\\,dx = \\\\sqrt{\\\\pi}
$$

Matrix example:

$$
\\\\begin{pmatrix}
a & b \\\\\\\\
c & d
\\\\end{pmatrix}
$$

## Code Blocks

### Python

\`\`\`python
def fibonacci(n: int) -> list[int]:
    """Return the first n Fibonacci numbers."""
    a, b = 0, 1
    result = []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b
    return result

print(fibonacci(10))
\`\`\`

### Rust

\`\`\`rust
use std::collections::HashMap;

fn main() {
    let mut scores = HashMap::new();
    scores.insert("Blue", 10);
    scores.insert("Red", 50);

    for (team, score) in &scores {
        println!("{}: {}", team, score);
    }
}
\`\`\`

### JavaScript

\`\`\`javascript
const greeting = (name) => {
  const now = new Date();
  return \`Hello \${name}! It's \${now.toLocaleTimeString()}.\`;
};

\`\`\`

### SQL

\`\`\`sql
SELECT users.name, orders.total
FROM users
JOIN orders ON users.id = orders.user_id
WHERE orders.created_at > '2025-01-01'
ORDER BY orders.total DESC
LIMIT 10;
\`\`\`

### YAML

\`\`\`yaml
server:
  host: 0.0.0.0
  port: 8080
database:
  url: postgres://localhost/meditor
  pool: 10
logging:
  level: info
  format: json
\`\`\`

### Dockerfile

\`\`\`dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
EXPOSE 80
\`\`\`

## Mermaid Diagrams

### Flowchart

\`\`\`mermaid
flowchart LR
  A[Editor] --> B{markdown-it}
  B --> C[Preview]
  B --> D[Mermaid Worker]
  B --> E[KaTeX]
  D -->|fallback| F[Main Thread]
\`\`\`

### Sequence Diagram

\`\`\`mermaid
sequenceDiagram
  participant U as User
  participant E as Editor
  participant P as Preview
  U->>E: Type markdown
  E->>P: Render content
  P-->>E: Sync scroll position
  P->>U: Display preview
\`\`\`

## Horizontal Rules

Above the rule…

---

…and below it.

## Blockquotes

> This is a blockquote.
>
> It can span multiple paragraphs.
>
> > Nested blockquotes are also supported.

## HTML Output (safe)

The following HTML tags are escaped: \\\\<script\\\\>alert('xss')\\\\<\\\\/script\\\\>

## Image Support

![Markdown logo](https://markdown-here.com/img/icon256.png)

_Drag-and-drop or paste images from your clipboard into the editor to embed them inline._
`;
