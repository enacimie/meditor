/**
 * Reading a pdfTeX failure.
 *
 * Its own module rather than part of `latexEngine`, which owns the WASM
 * engine's lifecycle and is replaced wholesale by `vi.mock` in the tests of
 * everything that uses it. A pure predicate kept in there would force every
 * one of those tests to stub it, which is how the same three lines came to
 * exist twice in the first place.
 */

/**
 * Whether a failed compilation failed for want of a format file.
 *
 * That is the one failure worth retrying: the engine can build the format and
 * run again. Every other non-zero status is the document's problem, and
 * retrying it only costs the user time.
 *
 * Takes the two fields rather than a `CompileResult` so the preview, which
 * holds the engine's own result object, can ask the same question through the
 * same pattern instead of keeping a copy of it.
 */
export function isMissingFormatError(status: number, log: string): boolean {
  return (
    status !== 0 &&
    /format file.*(?:can't find|not found)|can't find the format file/i.test(log)
  );
}
