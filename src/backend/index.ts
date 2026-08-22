import { isTauri } from "@tauri-apps/api/core";
import { tauriBackend } from "./tauriBackend";
import { webBackend } from "./webBackend";
import type { Backend } from "./types";

/**
 * The one backend for this run, chosen once: Tauri's IPC bridge inside the
 * app, browser APIs in the static web build. Everything downstream talks to
 * this object and never to `invoke` directly.
 */
export const backend: Backend = isTauri() ? tauriBackend : webBackend;

export type {
  Backend,
  BackendDocument,
  SessionInput,
  SessionRestorePayload,
} from "./types";
