// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSetAsideWhileHidden } from "./useSetAsideWhileHidden";

describe("useSetAsideWhileHidden", () => {
  let el: HTMLDivElement | undefined;

  afterEach(() => {
    el?.remove();
    el = undefined;
  });

  /** An element in the document holding a heading with an id, then a paragraph. */
  function mount() {
    el = document.createElement("div");
    document.body.append(el);
    const heading = document.createElement("h1");
    heading.id = "primero";
    const paragraph = document.createElement("p");
    el.append(heading, paragraph);
    return { ref: { current: el }, heading, paragraph };
  }

  it("takes the content out of the document while hidden, ids and all", () => {
    const { ref } = mount();
    renderHook(({ hidden }) => useSetAsideWhileHidden(ref, hidden), {
      initialProps: { hidden: true },
    });
    expect(el?.childNodes).toHaveLength(0);
    expect(document.getElementById("primero")).toBeNull();
  });

  it("puts the same nodes back, in their order, when it shows again", () => {
    const { ref, heading, paragraph } = mount();
    const { rerender } = renderHook(({ hidden }) => useSetAsideWhileHidden(ref, hidden), {
      initialProps: { hidden: true },
    });
    rerender({ hidden: false });
    expect([...(el?.childNodes ?? [])]).toEqual([heading, paragraph]);
    expect(document.getElementById("primero")).toBe(heading);
  });

  it("leaves an element that shows as it is", () => {
    const { ref, heading, paragraph } = mount();
    renderHook(() => useSetAsideWhileHidden(ref, false));
    expect([...(el?.childNodes ?? [])]).toEqual([heading, paragraph]);
  });
});
