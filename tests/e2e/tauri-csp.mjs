/**
 * The Content-Security-Policy the desktop app actually runs under.
 *
 * Tauri does not serve `app.security.csp` as written. When it embeds the
 * frontend it hashes every inline <script> and appends each 'sha256-…' to
 * `script-src` (tauri-codegen, `inject_script_hashes`), and it sends the
 * result with HTML responses only. A browser handed the bare string would
 * block index.html's own theme script — a violation the release does not
 * have — so this rebuilds the policy the same way, from the same two inputs:
 * the config, and the inline scripts of the page being served.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** `app.security.csp` from tauri.conf.json, as one policy string. */
export function readTauriCsp(projectRoot) {
  const config = JSON.parse(
    readFileSync(join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"),
  );
  const csp = config?.app?.security?.csp;
  if (typeof csp === "string") return csp;
  // Tauri also accepts a map of directive to sources.
  if (csp && typeof csp === "object") {
    return Object.entries(csp)
      .map(([directive, sources]) =>
        [directive, ...(Array.isArray(sources) ? sources : [sources])].join(" "),
      )
      .join("; ");
  }
  throw new Error("src-tauri/tauri.conf.json declares no app.security.csp");
}

/** Directive name → its sources, in the order the policy lists them. */
export function parseCsp(policy) {
  const directives = new Map();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length) directives.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return directives;
}

/**
 * 'sha256-…' for every inline script that has a body.
 *
 * Hashed after turning CR LF and lone CR into LF: the HTML parser does that
 * to the page before any script text exists, so it is what the browser hashes
 * — and what Tauri hashes too. A checkout with CRLF endings would otherwise
 * produce a hash no browser ever matches.
 */
export function inlineScriptHashes(html) {
  const hashes = [];
  for (const [, attributes, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attributes) || body.trim() === "") continue;
    const text = body.replace(/\r\n?/g, "\n");
    hashes.push(`'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`);
  }
  return hashes;
}

/** The policy as Tauri serves it: `script-src` gains the inline hashes. */
export function effectiveCsp(policy, hashes) {
  const directives = parseCsp(policy);
  const scriptSrc = directives.get("script-src");
  if (!scriptSrc) throw new Error("the policy has no script-src to add hashes to");
  directives.set("script-src", [...scriptSrc, ...hashes]);
  return [...directives].map(([name, sources]) => [name, ...sources].join(" ")).join("; ");
}

/** The policy for the build in `dist/`, as the desktop app would serve it. */
export function releaseCsp(projectRoot) {
  const html = readFileSync(join(projectRoot, "dist", "index.html"), "utf8");
  return effectiveCsp(readTauriCsp(projectRoot), inlineScriptHashes(html));
}
