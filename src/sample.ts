export const SAMPLE = `# meditor

Editor **Markdown** _extendido_ con render en vivo.

## Formato extendido

- ==marcado==, ++insertado++, H~2~O, E=mc^2^
- Emoji: :tada: :rocket:
- [Enlace](https://example.com) y autolink https://example.org

### Tabla

| Comando | Descripción |
| ------- | ----------- |
| dev     | arranca     |
| build   | compila     |

### Tareas

- [x] Scaffold
- [x] Deps
- [ ] Typst/LaTeX (fase 2)

### Lista de definiciones

Tauri
: Framework de apps de escritorio

### Abreviaturas

*[MD]: Markdown

El MD extendido mola.

::: warning
Cuidado con los contenedores personalizados.
:::

## Matemáticas (KaTeX)

Inline $e^{i\\pi} + 1 = 0$ y bloque:

$$
\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}
$$

## Código

\`\`\`python
def saludar(nombre: str) -> str:
    return f"Hola {nombre}"
\`\`\`

## Mermaid

\`\`\`mermaid
flowchart LR
  A[Editor] --> B{markdown-it}
  B --> C[Preview]
  B --> D[Mermaid]
  B --> E[KaTeX]
\`\`\`

## Footnotes

Texto con nota[^1].

[^1]: Aquí va la nota al pie.
`;
