/**
 * Tauri backend shim for E2E specs.
 *
 * The real app (`src/App.tsx`) imports `isTauri`, `invoke` and
 * `getCurrentWindow` from `@tauri-apps/api`. Those modules (v2.11.1) read
 * `window.isTauri` and `window.__TAURI_INTERNALS__` at runtime, so injecting
 * this shim via `Page.addScriptToEvaluateOnNewDocument` lets the *real* app
 * run as if it were inside the Tauri webview — no module mocking needed.
 *
 * The shim implements exactly the surface the app uses:
 *   - `window.isTauri`                      → makes `isTauri()` return true
 *   - `__TAURI_INTERNALS__.transformCallback` → stores callbacks by id
 *   - `__TAURI_INTERNALS__.invoke`          → answers the app's commands
 *   - `__TAURI_INTERNALS__.metadata.currentWindow.label` → for getCurrentWindow()
 *   - `plugin:event|listen` / `unlisten`    → registers event handlers
 *
 * It also exposes two test hooks on `window`:
 *   - `__meditorInvokes`: array of every invoke(cmd) call (in order)
 *   - `__meditorEmit(event, payload)`: fires the registered handlers, the
 *     way the Rust side would when emitting `tauri://close-requested`.
 *
 * The app's commands resolve synchronously-ish (microtask) and record
 * themselves in `__meditorInvokes` so specs can assert ordering, e.g.
 * `save_session` must precede `exit_app` in the close guard.
 */
export const TAURI_SHIM = `(() => {
  if (window.__meditorTauriShim) return;
  window.__meditorTauriShim = true;

  const callbacks = new Map(); // transformCallback id -> fn
  let nextCallbackId = 1;
  let nextEventId = 1;
  const listeners = new Map(); // event name -> Set<handlerId>
  const eventIdToHandler = new Map(); // eventId -> handlerId

  const invokes = []; // { cmd, args } in call order
  window.__meditorInvokes = invokes;
  /** True if cmd has been invoked at least once. */
  window.__meditorInvoked = (cmd) => invokes.some((i) => i.cmd === cmd);
  /** Command names in call order (for ordering assertions). */
  window.__meditorInvokeOrder = () => invokes.map((i) => i.cmd);

  // Anything a spec wants different from the defaults below. Set by an init
  // script registered BEFORE this one, so it is already in place when the
  // shim builds its canned session. Absent for every spec that does not care.
  const CONFIG = window.__meditorShimConfig ?? {};

  const SESSION = {
    docs: [
      {
        id: "e2e-doc",
        name: "E2E Doc",
        path: CONFIG.docPath ?? null,
        content: CONFIG.docContent ?? "# E2E session doc\\n\\nRestored by the shim.",
        dirty: false,
        handle: CONFIG.docHandle ?? null,
      },
    ],
    activeId: "e2e-doc",
    split: 50,
  };

  /**
   * Images the fake document has beside it: { "assets/x.png": "<base64>" }.
   *
   * The two image commands answer from this the way Rust answers from the
   * filesystem — a fingerprint for one that is there, nothing for one that is
   * not, and the bytes as an ArrayBuffer, which is what a Tauri command
   * returning raw bytes hands back.
   */
  const IMAGES = CONFIG.images ?? {};

  /** Every write_image call, so a spec can assert on what was stored. */
  const written = [];
  window.__meditorWrittenImages = () => written;

  function imageBytes(relPath) {
    const base64 = IMAGES[relPath];
    if (!base64) return null;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function handleInvoke(cmd, args) {
    switch (cmd) {
      case "cli_files":
        return [];
      case "load_session":
        return SESSION;
      // The interface asks Rust which OS it is on rather than trusting the
      // user agent. Answering "linux" keeps the specs on the desktop path,
      // where every menu entry is offered.
      case "platform":
        return "linux";
      case "image_stat": {
        const bytes = imageBytes(args?.relPath);
        return bytes ? { modifiedMs: 1700000000000, size: bytes.length } : null;
      }
      case "read_image": {
        const bytes = imageBytes(args?.relPath);
        return bytes ? bytes.buffer : new ArrayBuffer(0);
      }
      case "write_image": {
        // As Rust does: the name is a proposal, the folder is decided here,
        // and a name already taken gets a suffix rather than overwriting.
        if (!CONFIG.canWriteImages) return null;
        const name = String(args?.name ?? "");
        let candidate = name;
        let attempt = 0;
        while (IMAGES["assets/" + candidate] !== undefined) {
          attempt++;
          const dot = name.lastIndexOf(".");
          candidate =
            dot > 0
              ? name.slice(0, dot) + "-" + attempt + name.slice(dot)
              : name + "-" + attempt;
        }
        // Remember it, so the preview can read back what was just written.
        IMAGES["assets/" + candidate] = CONFIG.writtenImage ?? "";
        written.push({ name, relPath: "assets/" + candidate });
        return { relPath: "assets/" + candidate };
      }
      case "save_session":
      case "save_document":
      case "save_as":
      case "open_files":
      case "export_pdf":
      case "alert":
      case "exit_app":
      case "plugin:window|destroy":
      case "plugin:window|set_allow_close":
        return null;
      case "plugin:event|listen": {
        // args: { event, target, handler: <transformCallback id> }
        const { event, handler } = args ?? {};
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event).add(handler);
        const eventId = nextEventId++;
        eventIdToHandler.set(eventId, handler);
        return eventId;
      }
      case "plugin:event|unlisten": {
        // args: { event, eventId }
        const handlerId = eventIdToHandler.get(args?.eventId);
        if (handlerId !== undefined) listeners.get(args?.event)?.delete(handlerId);
        eventIdToHandler.delete(args?.eventId);
        return null;
      }
      default:
        // Unknown commands resolve to null instead of rejecting, so stray
        // IPC calls never surface as console errors in the spec.
        return null;
    }
  }

  window.isTauri = true;
  // The event plugin's own internals (event.js v2.11.1 calls
  // unregisterListener here before the plugin:event|unlisten invoke).
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(_event, _eventId) {
      // The plugin:event|unlisten invoke below does the actual cleanup.
    },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
    },
    transformCallback(callback, _once) {
      const id = nextCallbackId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    invoke(cmd, args) {
      invokes.push({ cmd, args });
      return Promise.resolve(handleInvoke(cmd, args));
    },
    convertFileSrc(path) {
      return path;
    },
  };

  // Fire all handlers registered for the event (the Rust emit path).
  window.__meditorEmit = (event, payload) => {
    const ids = listeners.get(event);
    if (!ids) return 0;
    let fired = 0;
    for (const handlerId of ids) {
      const cb = callbacks.get(handlerId);
      if (cb) {
        cb({ event, id: handlerId, payload: payload ?? null });
        fired++;
      }
    }
    return fired;
  };
})();
`;
