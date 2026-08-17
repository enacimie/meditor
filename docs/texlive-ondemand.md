# LaTeX con TeX Live Ondemand

SwiftLaTeX incluye el motor PdfTeX y sus archivos WASM en `public/swiftlatex/`,
pero descarga bajo demanda las clases, paquetes y fuentes de TeX Live. El
endpoint público histórico (`texlive2.swiftlatex.com`) no ofrece una
disponibilidad garantizada, por lo que el desarrollo reproducible usa el
servicio autoalojado de SwiftLaTeX.

## Arranque local

La verificación completa está automatizada en el workflow manual `LaTeX
integration` de GitHub Actions. El CI normal no construye esta imagen porque
la instalación completa de TeX Live puede ocupar varios GB y tardar varios
minutos.

Requisitos: Docker y Docker Compose.

```bash
docker compose -f docker-compose.texlive.yml up -d
cp .env.example .env.local
pnpm tauri dev
```

La primera construcción descarga una instalación completa de TeX Live y
compila las extensiones kpathsea; puede ocupar varios GB y tardar bastante.
El endpoint local queda en `http://127.0.0.1:5000/` (host `5000` → contenedor
`5001`). Vite lee `VITE_TEXLIVE_ENDPOINT` y lo propaga al worker PdfTeX antes
de cargar el WASM.

## Verificación

El servicio upstream no define una ruta `/health`. La imagen local incorpora
un healthcheck que consulta `article.cls` mediante kpathsea, la misma ruta que
usa PdfTeX. Comprueba el estado del contenedor y observa las peticiones que
llegan durante una compilación:

```bash
docker compose -f docker-compose.texlive.yml ps
docker compose -f docker-compose.texlive.yml logs -f texlive-ondemand
```

El motor necesita las rutas compatibles con SwiftLaTeX:

- `/pdftex/<file-format>/<filename>`
- `/pdftex/pk/<dpi>/<filename>`

La misma prueba puede ejecutarse localmente después de arrancar el servicio:

```bash
VITE_TEXLIVE_ENDPOINT=http://127.0.0.1:5000/ pnpm test:e2e:latex
```

Para detener el servicio:

```bash
docker compose -f docker-compose.texlive.yml down
```

## Tauri y CSP

La CSP de Tauri ya permite `127.0.0.1:5000`. Si se utiliza un endpoint
remoto distinto, hay que añadir su origen a `connect-src` en
`src-tauri/tauri.conf.json` antes de empaquetar la aplicación.
