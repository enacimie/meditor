# meditor

Editor de textos de escritorio **Markdown extendido**, sencillo pero potente, construido con [Tauri](https://tauri.app) (Rust) y React. Renderizado en vivo, exportación a PDF vectorial y sincronización bidireccional editor ↔ preview al estilo de Overleaf.

![Captura de meditor](screenshots/screenshot1.png)

## Características

### Markdown extendido

- **GFM**: tablas, listas de tareas, tachado y autolinks.
- **Extensiones**: resaltado `==marcado==`, `++insertado++`, subíndice `H~2~O`, superíndice `E=mc^2^`, notas al pie, listas de definiciones, abreviaturas, emoji 😊 y contenedores personalizados (`::: warning`, `::: note`).
- **Matemáticas** con [KaTeX](https://katex.org): en línea `$e^{i\pi}+1=0$` y en bloque `$$ ... $$`.
- **Diagramas** [Mermaid](https://mermaid.js.org) (flowchart, sequence, gantt, etc.), renderizados como **SVG vectorial**.
- **Resaltado de código** con [highlight.js](https://highlightjs.org).

### Edición

- Editor [CodeMirror 6](https://codemirror.net) con resaltado de sintaxis Markdown y de bloques de código.
- **Pestañas multi-documento**: crear, cerrar, renombrar (doble clic) e indicador de cambios sin guardar.
- **Estado independiente por pestaña** (historial de deshacer y scroll propios).
- **Persistencia**: abrir/guardar archivos reales y **restauración de la sesión** (pestañas y contenido) entre ejecuciones.

### Preview y sincronización

- Dos modos de vista previa:
  - **Web**: vista cómoda de pantalla.
  - **Documento**: páginas **A4 paginadas** con [paged.js](https://pagedjs.org) y estética LaTeX (fuente **Latin Modern**, texto justificado, tablas tipo *booktabs*).
- **Sincronización bidireccional** editor ↔ preview:
  - **Doble clic** en el preview → salta a la línea de código correspondiente.
  - Botones **"Ir al preview"** e **"Ir al código"** en cada panel.
  - Un clic en el preview **marca** la posición (contorno azul) como referencia para el salto.
- **Paneles redimensionables** arrastrando el divisor.

### Exportación y distribución

- **Exportar a PDF** vectorial (texto seleccionable, KaTeX y Mermaid vectoriales) mediante la impresión de WebKitGTK, sin diálogo del sistema. Formato A4 con márgenes de 2,5 cm.
- Empaquetado como **AppImage**, **deb** y **rpm** con `tauri build`.

## Stack tecnológico

| Capa             | Tecnología                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| Shell de escritorio | [Tauri v2](https://tauri.app) (Rust + WebKitGTK)                                                     |
| Frontend         | React 19 + TypeScript + Vite                                                                            |
| Editor           | CodeMirror 6                                                                                            |
| Markdown         | markdown-it + plugins (GFM, footnote, mark, sub/sup, ins, deflist, abbr, emoji, container, texmath, highlightjs) |
| Matemáticas      | KaTeX                                                                                                   |
| Diagramas        | Mermaid                                                                                                 |
| Código           | highlight.js                                                                                            |
| Paginación       | paged.js                                                                                                |
| Tipografía       | Latin Modern (GUST)                                                                                     |

## Requisitos previos

- [Rust](https://rustup.rs) (cargo).
- [Node.js](https://nodejs.org) 20+ y [pnpm](https://pnpm.io).
- **Linux** (Ubuntu/Debian): dependencias del sistema para Tauri/WebKitGTK:

  ```bash
  sudo apt update && sudo apt install -y \
    libwebkit2gtk-4.1-dev build-essential curl wget file \
    libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
  ```

  (También puedes ejecutar `./setup.sh`, que instala lo necesario.)

## Desarrollo

```bash
pnpm install
pnpm tauri dev
```

`pnpm tauri dev` arranca Vite y la ventana nativa con recarga en caliente.

> Para probar solo el frontend en el navegador: `pnpm dev` (las funciones de escritorio —abrir/guardar, PDF y sesión— requieren la app nativa).

## Construcción

```bash
pnpm tauri build
```

Genera (en `src-tauri/target/release/bundle/`):

- `appimage/meditor_<versión>_amd64.AppImage`
- `deb/meditor_<versión>_amd64.deb`
- `rpm/meditor-<versión>-1.x86_64.rpm`

Para ejecutar el AppImage en distribuciones sin FUSE: `./meditor_*.AppImage --appimage-extract-and-run` (o instala `libfuse2`).

## Atajos de teclado

| Atajo          | Acción            |
| -------------- | ----------------- |
| `Ctrl+N`       | Nuevo documento   |
| `Ctrl+O`       | Abrir archivo(s)  |
| `Ctrl+S`       | Guardar           |
| `Ctrl+Shift+S` | Guardar como      |
| `Ctrl+E`       | Exportar a PDF    |
| `Ctrl+W`       | Cerrar pestaña    |

Además: **doble clic** en el preview para ir al código y arrastre del divisor para redimensionar los paneles.

## Estructura del proyecto

```
meditor/
├── index.html
├── src/
│   ├── main.tsx          # punto de entrada de React
│   ├── App.tsx           # estado global, pestañas, sync y paneles
│   ├── App.css           # estilos (pantalla e impresión)
│   ├── Editor.tsx        # CodeMirror 6 (estado por pestaña)
│   ├── Preview.tsx       # render + mermaid + paginación (paged.js)
│   ├── markdown.ts       # configuración de markdown-it + data-line
│   ├── paged.css         # estilos de la vista Documento (A4)
│   ├── sample.ts         # documento de ejemplo
│   ├── shims.d.ts        # declaraciones de tipos
│   └── assets/fonts/     # fuentes Latin Modern (GUST)
├── src-tauri/
│   ├── src/lib.rs        # comandos: leer/guardar, sesión y exportar PDF
│   ├── tauri.conf.json
│   ├── capabilities/     # permisos (dialog, opener)
│   └── Cargo.toml
└── setup.sh              # instala las dependencias del sistema (Linux)
```

## Fuentes

Las fuentes **Latin Modern** incluidas en `src/assets/fonts/` se distribuyen bajo la [GUST Font License](src/assets/fonts/GUST-FONT-LICENSE.TXT) (libre). Consulta el archivo de licencia adjunto.

## Licencia

Las fuentes Latin Modern están bajo la GUST Font License (ver `src/assets/fonts/GUST-FONT-LICENSE.TXT`). La licencia del código de la aplicación está por definir.

## IDE recomendado

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
