/**
 * Type shims for third-party modules that lack their own type definitions.
 *
 * These declarations enable TypeScript to consume the following packages
 * without errors, providing minimal but sufficient type information for
 * the subset of each API that meditor actually uses.
 */

declare module "markdown-it-highlightjs/core" {
  const plugin: (
    md: import("markdown-it").default,
    options?: Record<string, unknown>,
  ) => void;
  export default plugin;
}
declare module "markdown-it-task-lists";
declare module "markdown-it-footnote";
declare module "markdown-it-mark";
declare module "markdown-it-sub";
declare module "markdown-it-sup";
declare module "markdown-it-ins";
declare module "markdown-it-deflist";
declare module "markdown-it-abbr";
declare module "markdown-it-emoji";
declare module "markdown-it-container";
declare module "markdown-it-texmath";

declare module "pagedjs" {
  export class Previewer {
    preview(
      content: string | HTMLElement | Array<string | HTMLElement>,
      stylesheets?: Array<string | Record<string, string>>,
      renderTo?: HTMLElement,
    ): Promise<unknown>;
  }
}
