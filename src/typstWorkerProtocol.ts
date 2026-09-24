/**
 * What the page and the Typst worker say to each other.
 *
 * The page asks for a document compiled to SVG (the preview) or to PDF (the
 * export) and the worker answers with it, or with the error the compiler gave.
 * Kept apart from both ends so it can be tested without either.
 */

export type TypstRequest = {
  id: number;
  kind: "svg" | "pdf";
  mainContent: string;
  /**
   * The page's address, which the fonts are served beside. A worker knows
   * only its own script's, which is not the same place.
   */
  fontBase: string;
};

export type TypstReply =
  | { id: number; svg: string }
  | { id: number; pdf: Uint8Array | undefined }
  | { id: number; error: string };

/** The part of typst.ts's snippet the application uses. */
export interface TypstApi {
  svg(options: { mainContent: string }): Promise<string>;
  pdf(options: { mainContent: string }): Promise<Uint8Array | undefined>;
}

export type Answer = { reply: TypstReply; transfer: Transferable[] };

/**
 * Answer one request with `api`: the reply, and the buffers that can be moved
 * to the page rather than copied (a PDF's bytes).
 *
 * A compile error is an answer too. It is turned into its message here, where
 * it can still be read: what crosses to the page has to survive being cloned.
 */
export async function answer(api: TypstApi, request: TypstRequest): Promise<Answer> {
  try {
    if (request.kind === "svg") {
      const svg = await api.svg({ mainContent: request.mainContent });
      return { reply: { id: request.id, svg }, transfer: [] };
    }
    const pdf = await api.pdf({ mainContent: request.mainContent });
    return { reply: { id: request.id, pdf }, transfer: pdf ? [pdf.buffer as ArrayBuffer] : [] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { reply: { id: request.id, error: message }, transfer: [] };
  }
}
