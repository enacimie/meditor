import { EditorState, type Extension } from "@codemirror/state";
import type { TranslationFn, TranslationKey } from "./i18n/translations";

/**
 * CodeMirror's own words, keyed by the English it ships with.
 *
 * The find and replace panel, "Go to line", the fold markers and what the
 * editor announces to a screen reader are all written by CodeMirror, which
 * asks `state.phrase()` for each one. `EditorState.phrases` is how an
 * application answers; without it they stay English in every language.
 *
 * This is every string the @codemirror packages pass to `phrase()`.
 * editorPhrases.test.ts reads them out of node_modules, so an upgrade that
 * adds one fails there instead of shipping in English. A "$" is where
 * CodeMirror puts a number, and every translation has to keep it.
 */
export const EDITOR_PHRASES = {
  // Find and replace
  Find: "editor.search.find",
  Replace: "editor.search.replaceField",
  next: "editor.search.next",
  previous: "editor.search.previous",
  all: "editor.search.all",
  "match case": "editor.search.matchCase",
  regexp: "editor.search.regexp",
  "by word": "editor.search.byWord",
  replace: "editor.search.replace",
  "replace all": "editor.search.replaceAll",
  "current match": "editor.search.currentMatch",
  "on line": "editor.search.onLine",
  "replaced $ matches": "editor.search.replacedMatches",
  "replaced match on line $": "editor.search.replacedMatchOnLine",
  // Go to line
  "Go to line": "editor.gotoLine.label",
  go: "editor.gotoLine.go",
  // Folding
  "Fold line": "editor.fold.foldLine",
  "Unfold line": "editor.fold.unfoldLine",
  "folded code": "editor.fold.foldedCode",
  unfold: "editor.fold.unfold",
  "Folded lines": "editor.fold.foldedLines",
  "Unfolded lines": "editor.fold.unfoldedLines",
  to: "editor.fold.to",
  // Everything else
  close: "editor.close",
  "Selection deleted": "editor.selectionDeleted",
  "Control character": "editor.controlCharacter",
  Completions: "editor.completions",
  Diagnostics: "editor.diagnostics",
  "No diagnostics": "editor.noDiagnostics",
} as const satisfies Record<string, TranslationKey>;

/** The phrases for one interface language, ready for a compartment. */
export function editorPhrases(t: TranslationFn): Extension {
  const phrases: Record<string, string> = {};
  for (const [phrase, key] of Object.entries(EDITOR_PHRASES)) {
    phrases[phrase] = t(key);
  }
  return EditorState.phrases.of(phrases);
}
