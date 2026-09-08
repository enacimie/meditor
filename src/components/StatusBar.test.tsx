// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import StatusBar from "./StatusBar";
import { translations } from "../i18n/translations";
import type { TranslationFn } from "../i18n/translations";

/**
 * The real English table, not a stub.
 *
 * A stub would let the counts be asserted against wording this file invented,
 * and the plural forms — "1 word" against "2 words" — are part of what is
 * being checked.
 */
const t = ((key: string, ...args: unknown[]) => {
  const value = (translations.en as Record<string, unknown>)[key];
  if (typeof value === "function") return (value as (...a: unknown[]) => string)(...args);
  return typeof value === "string" ? value : key;
}) as TranslationFn;

// The suite shares one document, as every component test here does.
afterEach(() => {
  cleanup();
});

describe("the status bar", () => {
  it("counts words, lines and characters", () => {
    render(<StatusBar t={t} content={"uno dos\ntres"} />);
    expect(screen.getByText("3 words")).toBeDefined();
    expect(screen.getByText("2 lines")).toBeDefined();
    expect(screen.getByText("12 chars")).toBeDefined();
  });

  it("counts nothing in an empty document", () => {
    render(<StatusBar t={t} content="" />);
    expect(screen.getByText("0 words")).toBeDefined();
    expect(screen.getByText("0 lines")).toBeDefined();
  });

  describe("the reading estimate", () => {
    /** `n` words, so the estimate can be read off a known count. */
    const words = (n: number) => Array.from({ length: n }, () => "palabra").join(" ");

    it("is one minute for anything up to two hundred words", () => {
      render(<StatusBar t={t} content={words(200)} />);
      expect(screen.getByText("1 min read")).toBeDefined();
    });

    it("rounds up, so a document is never said to take no time", () => {
      // 201 words is two minutes rather than one and a bit, and 1 word is one
      // minute rather than zero: the smallest answer has to be the smallest
      // true one.
      const { unmount } = render(<StatusBar t={t} content={words(201)} />);
      expect(screen.getByText("2 min read")).toBeDefined();
      unmount();
      render(<StatusBar t={t} content="hola" />);
      expect(screen.getByText("1 min read")).toBeDefined();
    });

    it("is zero for an empty document, which takes no reading", () => {
      render(<StatusBar t={t} content="" />);
      expect(screen.getByText("0 min read")).toBeDefined();
    });

    it("counts at two hundred words a minute", () => {
      // The rate itself, pinned: 1000 words is five minutes at 200 and would
      // be four at 250 or seven at 150.
      render(<StatusBar t={t} content={words(1000)} />);
      expect(screen.getByText("5 min read")).toBeDefined();
    });
  });

  describe("the caret position", () => {
    it("shows the line and column it is given", () => {
      render(<StatusBar t={t} content="uno" cursorLine={4} cursorColumn={12} />);
      expect(screen.getByText("Ln 4, Col 12")).toBeDefined();
    });

    it("says nothing when there is no position to show", () => {
      // The preview-only layout has no caret, and a stale one would be worse
      // than none.
      render(<StatusBar t={t} content="uno" />);
      expect(screen.queryByText(/^Ln /)).toBeNull();
    });
  });
});
