/**
 * marp-core's transitive dependencies assume a Node-style `global` object and
 * read `global.location` / `global.localStorage` at module scope, which throws
 * in a browser. Import this before anything from @marp-team/marp-core so the
 * binding exists by the time those modules evaluate.
 */
const scope = globalThis as Record<string, unknown>;
if (typeof scope.global === "undefined") {
  scope.global = globalThis;
}
