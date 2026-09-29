import { useCallback, useState } from "react";

/** The caret's line and column, as the editor last reported them. */
export function useCursorPosition() {
  /*
   * Where the caret is. The line has always been tracked, for the outline to
   * highlight the heading being written under; the column joins it so the
   * status bar can say the position the way an editor is expected to.
   *
   * The line is zero-based here because that is what the outline indexes with.
   * The status bar adds one.
   */
  const [cursorLine, setCursorLine] = useState(0);
  const [cursorColumn, setCursorColumn] = useState(1);
  const onCursorMoved = useCallback((line: number, column: number) => {
    setCursorLine(line);
    setCursorColumn(column);
  }, []);

  return { cursorLine, cursorColumn, onCursorMoved };
}
