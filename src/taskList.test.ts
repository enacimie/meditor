import { describe, it, expect } from "vitest";
import { taskToggleOnLine } from "./taskList";

/** Apply a toggle to a line, the way the editor's one-character change does. */
function applied(line: string): string | null {
  const toggle = taskToggleOnLine(line);
  if (!toggle) return null;
  return line.slice(0, toggle.at) + toggle.insert + line.slice(toggle.at + 1);
}

describe("finding the box on a task line", () => {
  it("ticks a pending task", () => {
    expect(applied("- [ ] buy milk")).toBe("- [x] buy milk");
  });

  it("unticks a finished one", () => {
    expect(applied("- [x] buy milk")).toBe("- [ ] buy milk");
  });

  it("writes a lower-case x over a shouted one", () => {
    expect(applied("- [X] shout")).toBe("- [ ] shout");
    expect(applied("- [ ] shout")).toBe("- [x] shout");
  });

  it("accepts every bullet Markdown allows", () => {
    expect(applied("* [ ] star")).toBe("* [x] star");
    expect(applied("+ [ ] plus")).toBe("+ [x] plus");
    expect(applied("1. [ ] one")).toBe("1. [x] one");
    expect(applied("2) [ ] two")).toBe("2) [x] two");
  });

  it("finds the box of a nested item", () => {
    expect(applied("    - [ ] deep")).toBe("    - [x] deep");
    expect(taskToggleOnLine("    - [ ] deep")?.at).toBe(7);
  });

  it("leaves a second box further along the line alone", () => {
    expect(applied("- [ ] see the [ ] over there")).toBe("- [x] see the [ ] over there");
  });

  it("refuses a line that only mentions a checkbox", () => {
    for (const line of [
      "Some prose about [ ] checkboxes.",
      "[ ] no bullet in front of it",
      "> - [ ] quoted, and not a list item of ours",
      "- [] no room for a state",
      "- [y] not a state we know",
      "-[ ] no space after the bullet",
      "",
    ]) {
      expect(taskToggleOnLine(line), line).toBeNull();
    }
  });
});
