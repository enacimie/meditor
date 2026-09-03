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
- [x] Typst support
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

export const TYPST_SAMPLE = `= meditor + Typst
#set page(margin: 2.5cm)
#set text(size: 11pt, lang: "en")
#set heading(numbering: "1.")

This is a *Typst* document edited in meditor with live preview,
syntax highlighting, and bidirectional sync.

== Typography

- *Bold*, _italic_, #underline[underline], #strike[strikethrough]
- Superscript: E = mc#super[2]
- Subscript: H#sub[2]O
- #smallcaps[Small caps] and #text(fill: blue)[colored text]

== Links & References

- Link to #link("https://typst.app")[Typst homepage]
- Reference a section: @tables
- Cite with @math

== Tables <tables>

#table(
  columns: 3,
  stroke: 0.5pt,
  align: (left, center, center),
  table.header(
    [*Feature*], [*Status*], [*Priority*],
  ),
  [Markdown], [Done], [High],
  [KaTeX], [Done], [Medium],
  [Typst], [Done], [High],
  [LaTeX], [Done], [Medium],
)

== Lists

+ First ordered item
+ Second ordered item
  - Nested unordered
  - Another nested item
+ Third item with a term

/ Definition:
  A precise statement of the meaning of a word or concept.

== Mathematics <math>

Inline math: $e^(i pi) + 1 = 0$ (Euler's identity).

Display math:

$ integral_(-oo)^oo e^(-x^2) dif x = sqrt(pi) $

A matrix:

$ mat(a, b; c, d) $

Aligned equations:

$ f(x) &= x^2 + 2x + 1 \\
      &= (x + 1)^2 $

== Code Blocks

#figure(
  caption: [Fibonacci in Python],
  raw("def fibonacci(n: int) -> list[int]:\n    Return the first n Fibonacci numbers.\n    a, b = 0, 1\n    result = []\n    for _ in range(n):\n        result.append(a)\n        a, b = b, a + b\n    return result\n\nprint(fibonacci(10))", lang: "python"),
)

And inline \`raw("print(42)", lang: "python")\` code.

== Theorems & Callouts

#block(
  fill: rgb("#fff3cd"),
  inset: 8pt,
  radius: 4pt,
  stroke: 0.5pt + rgb("#ffc107"),
  [
    *⚠ Warning:* Be careful when editing large documents — auto-save
    is enabled by default.
  ],
)

#block(
  fill: rgb("#d1ecf1"),
  inset: 8pt,
  radius: 4pt,
  stroke: 0.5pt + rgb("#17a2b8"),
  [
    *💡 Pro tip:* Use *Ctrl+Shift+S* to save a copy, and *Ctrl+E* to
    export as PDF.
  ],
)

== Horizontal Rules

Above the rule…

#line(length: 100%)

…and below it.

== Blockquotes

#quote(block: true)[
  This is a blockquote.

  It can span multiple paragraphs.
]

== Document setup

- Page: A4 with 2.5 cm margins
- Font: Latin Modern Roman, 11 pt
- Justified text with hyphenation
- Line numbering for review

_Start typing Typst in meditor — live preview updates as you write._
`;

export const LATEX_SAMPLE = `\\documentclass[a4paper,11pt]{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}
\\usepackage{amsmath, amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{booktabs}
\\usepackage[margin=2.5cm]{geometry}

\\title{meditor + \\LaTeX}
\\author{meditor}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Introduction}

This is a \\LaTeX\\ document edited in meditor with syntax highlighting.
Live preview and PDF compilation are available with the configured TeX Live endpoint.

\\section{Typography}

\\textbf{Bold}, \\textit{italic}, \\underline{underline}, and
\\texttt{monospace} text. \\textsc{Small caps} and \\textsf{sans-serif}.

Footnotes are easy\\footnote{This is a footnote.}. You can also add
marginal notes with the \\marginpar command.

\\section{Mathematics}

Euler's identity: $e^{i\\pi} + 1 = 0$.

The Gaussian integral:
\\begin{equation}
  \\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
\\end{equation}

A matrix:
\\begin{equation}
  \\begin{pmatrix}
    a & b \\\\
    c & d
  \\end{pmatrix}
\\end{equation}

Aligned equations:
\\begin{align}
  f(x) &= x^2 + 2x + 1 \\\\
       &= (x + 1)^2
\\end{align}

\\section{Tables}

\\begin{table}[h]
  \\centering
  \\begin{tabular}{lcc}
    \\toprule
    \\textbf{Feature} & \\textbf{Status} & \\textbf{Priority} \\\\
    \\midrule
    Markdown & Done & High \\\\
    KaTeX & Done & Medium \\\\
    Typst & Done & High \\\\
    LaTeX & Done & Medium \\\\
    \\bottomrule
  \\end{tabular}
  \\caption{Feature status overview}
\\end{table}

\\section{Lists}

\\begin{itemize}
  \\item First unordered item
  \\item Second unordered item
  \\begin{itemize}
    \\item Nested item
    \\item Another nested item
  \\end{itemize}
  \\item Third item
\\end{itemize}

\\begin{enumerate}
  \\item First ordered item
  \\item Second ordered item
  \\item Third item
\\end{enumerate}

\\section{Code}

\\begin{verbatim}
def fibonacci(n: int) -> list[int]:
    """Return the first n Fibonacci numbers."""
    a, b = 0, 1
    result = []
    for _ in range(n):
        result.append(a)
        a, b = b, a + b
    return result
\\end{verbatim}

\\section{Theorems}

\\begin{quote}
  This is a blockquote. It can span multiple lines and the \\LaTeX\\
  compiler handles the line breaking automatically.
\\end{quote}

\\section{References}

- \\href{https://www.latex-project.org}{LaTeX Project}
- \\href{https://ctan.org}{CTAN — Comprehensive TeX Archive Network}

\\emph{Start typing LaTeX in meditor --- syntax highlighting is ready, compilation is available with the configured TeX Live endpoint.}

\\end{document}
`;

export const MARP_SAMPLE = `---
marp: true
theme: default
paginate: true
---

# meditor + Marp

Presentations written in Markdown and rendered live.

---

## Why slides in an editor?

- Write the deck next to your notes — same tab bar
- The preview updates as you type
- Click a slide to jump back to its source

---

## Math, with KaTeX

Inline math like $e^{i\\pi}+1=0$, or a display equation:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

---

## Code, highlighted

\`\`\`js
function greet(name) {
  return "Hello, " + name + "!";
}
\`\`\`

---

## A table

| Format | Preview | Export |
| ----- | :---: | :---: |
| Markdown | Yes | PDF / HTML |
| Slides | Yes | PDF / HTML |

---

<!-- _class: lead -->

# Thank you

Every \`---\` on its own line starts a new slide.
`;
