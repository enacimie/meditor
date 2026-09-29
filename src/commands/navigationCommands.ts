import type { AppScope } from "../appScope";
import type { LayoutMode } from "../components/types";

/**
 * Jumping between the panes — to the line in the code, to the block in the
 * preview — and into the find panel, bringing back whichever pane the jump
 * lands in.
 */
export function createNavigationCommands(
  scope: Pick<
    AppScope,
    | "ready"
    | "coarsePointer"
    | "layoutMode"
    | "setLayoutMode"
    | "zenMode"
    | "editorRef"
    | "previewRef"
    | "confirmRequest"
    | "renameRequest"
    | "shortcutsOpen"
    | "preferencesOpen"
    | "aboutOpen"
  >,
) {
  const {
    ready,
    coarsePointer,
    layoutMode,
    setLayoutMode,
    zenMode,
    editorRef,
    previewRef,
    confirmRequest,
    renameRequest,
    shortcutsOpen,
    preferencesOpen,
    aboutOpen,
  } = scope;

  /**
   * The layout that brings `pane` into view.
   *
   * On a desktop that is the split, which keeps the pane you were in. A touch
   * screen has no split to fall back on, so the jump has to hand the whole
   * workspace to the pane it is aiming at — otherwise "go to code" from the
   * reader would go nowhere at all.
   */
  function revealing(pane: "editor" | "preview"): LayoutMode {
    return coarsePointer ? pane : "split";
  }

  /**
   * Jump to a line of the source, bringing the editor back if it is hidden.
   *
   * In preview-only mode the editor is display:none, so CodeMirror cannot
   * measure anything: the scroll has to wait for the layout to come back,
   * hence the frame. scrollToLine() ends in view.focus(), so the reader lands
   * ready to type.
   */
  function goToCode(line: number) {
    if (layoutMode === "preview") {
      setLayoutMode(revealing("editor"));
      requestAnimationFrame(() => editorRef.current?.scrollToLine(line));
      return;
    }
    editorRef.current?.scrollToLine(line);
  }

  function handleReverseSync(line: number) {
    /*
     * Only a mouse means this. A tap is how you read on a phone, and turning
     * every tap into "jump to the source" would throw the reader into the
     * editor — with the on-screen keyboard over half the screen — for touching
     * the paragraph they were reading. The mark still lands, so the "go to
     * code" button in the header has somewhere to go.
     */
    if (coarsePointer) return;
    goToCode(line);
  }

  /*
   * Mirror of goToCode. Both panes offer a jump to the other one, and both
   * bring that pane back when it is off screen — otherwise the button in the
   * solo layouts would point at something the user cannot see.
   *
   * The preview needs more care than the editor: while its pane is hidden its
   * rendering is deferred, so right after the switch it holds nothing to
   * scroll to. It remembers the request and applies it once it has rendered.
   */
  function goToPreview(line: number) {
    if (layoutMode === "editor") {
      setLayoutMode(revealing("preview"));
      requestAnimationFrame(() => previewRef.current?.scrollToLine(line));
      return;
    }
    previewRef.current?.scrollToLine(line);
  }

  function handleForwardSync() {
    goToPreview(editorRef.current?.getCursorLine() ?? 0);
  }

  function handleReverseSyncButton() {
    const line = previewRef.current?.getTargetLine() ?? 0;
    goToCode(line);
  }

  /**
   * Tick a task off from the preview.
   *
   * Handed straight to the editor, which owns the text. Going through
   * `updateContent` would work and be shorter, but a whole-document update
   * rebuilds the `EditorState`, and losing the undo history because you
   * ticked a box is a worse bug than the one this fixes.
   */
  function toggleTask(line: number) {
    editorRef.current?.toggleTask(line);
  }

  /**
   * Open the find panel, bringing the editor back if it is hidden.
   *
   * Picking Find from the menu, or pressing Ctrl+F, the key that menu entry
   * shows, is an explicit request, so it takes the reader to the source
   * instead of quietly failing.
   *
   * Zen mode always shows the editor, whatever layout it will return to, so
   * there is nothing to reveal there; switching the layout would only change
   * what the reader finds on leaving it.
   */
  function findInDocument() {
    if (!ready) return;
    if (layoutMode === "preview" && !zenMode) {
      setLayoutMode(revealing("editor"));
      requestAnimationFrame(() => editorRef.current?.focusSearch());
      return;
    }
    editorRef.current?.focusSearch();
  }

  /**
   * Whether a shortcut may move focus into the find panel.
   *
   * Ctrl+F puts the caret in a field that is already on screen rather than
   * opening something of its own, so it must not take it from another field
   * (LanguagePicker search, rename dialog) or open the panel behind a modal
   * dialog.
   */
  function findPanelReachable() {
    if (!ready) return false;
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
      return false;
    }
    if (confirmRequest || renameRequest || shortcutsOpen) return false;
    if (preferencesOpen || aboutOpen) return false;
    return true;
  }

  return {
    handleReverseSync,
    handleForwardSync,
    handleReverseSyncButton,
    toggleTask,
    findInDocument,
    findPanelReachable,
  };
}
