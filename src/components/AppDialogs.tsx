import { lazy, Suspense, type Dispatch, type SetStateAction } from "react";
import type { EditorPreferences } from "../editorPreferences";
import type { UpdateCheckAPI } from "../hooks/useUpdateCheck";
import type { TranslationFn } from "../i18n/translations";
import ConfirmDialog from "./ConfirmDialog";
import ConflictDialog from "./ConflictDialog";
import RenameDialog from "./RenameDialog";
import ShortcutsOverlay from "./ShortcutsOverlay";
import AboutDialog from "./AboutDialog";
import type { ConfirmRequest, ConflictRequest, RenameRequest } from "./types";

const PreferencesDialog = lazy(() => import("./PreferencesDialog"));
const PresentOverlay = lazy(() => import("./PresentOverlay"));

type Props = {
  t: TranslationFn;
  confirmRequest: ConfirmRequest | null;
  answerConfirm: (answer: boolean) => void;
  updates: UpdateCheckAPI;
  conflictRequest: ConflictRequest | null;
  renameRequest: RenameRequest | null;
  resolveConflictReload: () => void;
  resolveConflictKeep: () => void;
  resolveConflictSaveAs: () => void;
  setRenameRequest: Dispatch<SetStateAction<RenameRequest | null>>;
  preferencesOpen: boolean;
  setPreferencesOpen: Dispatch<SetStateAction<boolean>>;
  aboutOpen: boolean;
  setAboutOpen: Dispatch<SetStateAction<boolean>>;
  shortcutsOpen: boolean;
  setShortcutsOpen: Dispatch<SetStateAction<boolean>>;
  editorPrefs: EditorPreferences;
  setEditorPrefs: Dispatch<SetStateAction<EditorPreferences>>;
  presenting: boolean;
  isActiveMarp: boolean;
  activeContent: string;
  exitPresent: () => void;
};

/**
 * Everything that opens over the workspace: the questions, the conflict and
 * rename dialogs, the shortcuts, About and Preferences, and the slideshow.
 *
 * In the order App always rendered them, with the same keys. It keeps no
 * state: App decides which are open and hands everything down.
 */
export default function AppDialogs({
  t,
  confirmRequest,
  answerConfirm,
  updates,
  conflictRequest,
  renameRequest,
  resolveConflictReload,
  resolveConflictKeep,
  resolveConflictSaveAs,
  setRenameRequest,
  preferencesOpen,
  setPreferencesOpen,
  aboutOpen,
  setAboutOpen,
  shortcutsOpen,
  setShortcutsOpen,
  editorPrefs,
  setEditorPrefs,
  presenting,
  isActiveMarp,
  activeContent,
  exitPresent,
}: Props) {
  return (
    <>
      {confirmRequest && (
        <ConfirmDialog
          // Remount, do not reuse: without this the dialog keeps its focus
          // and its exit timer across a replacement, so the text changes
          // under the reader and a pending close can fire the old answer.
          key={confirmRequest.seq}
          title={t("confirm.title")}
          message={confirmRequest.message}
          confirmLabel={t("confirm.yes")}
          cancelLabel={t("confirm.no")}
          onConfirm={() => {
            answerConfirm(true);
          }}
          onCancel={() => {
            answerConfirm(false);
          }}
        />
      )}
      {/*
        One modal at a time. The offer waits its turn behind whichever
        dialog is up — it is state, not a queue entry that expires, so the
        moment the last one closes this renders. Two `aria-modal` surfaces
        at once trap the focus in whichever mounted last, and the Escape
        that closes one lands on the other.
      */}
      {updates.offer &&
        !confirmRequest &&
        !conflictRequest &&
        !renameRequest &&
        !preferencesOpen &&
        !aboutOpen &&
        !shortcutsOpen && (
        <ConfirmDialog
          title={t("update.title")}
          message={t("update.available", updates.offer.version, updates.offer.current)}
          confirmLabel={t("update.install")}
          cancelLabel={t("update.later")}
          onConfirm={() => {
            void updates.offer?.install();
          }}
          onCancel={updates.dismiss}
        />
      )}
      {conflictRequest && (
        <ConflictDialog
          title={t("conflict.externalTitle")}
          message={t("conflict.externalMessage", conflictRequest.name)}
          reloadLabel={t("conflict.reload")}
          keepLabel={t("conflict.keepMine")}
          saveAsLabel={t("conflict.saveAsAction")}
          onReload={resolveConflictReload}
          onKeep={resolveConflictKeep}
          onSaveAs={resolveConflictSaveAs}
        />
      )}
      {renameRequest && (
        <RenameDialog
          // Remount per request, as ConfirmDialog does: a reuse would carry
          // the previous rename's focus, its input value and its exit timer.
          key={renameRequest.id}
          title={t("tab.renameTitle")}
          label={t("tab.renamePrompt")}
          initialValue={renameRequest.name}
          confirmLabel={t("tab.rename")}
          cancelLabel={t("tab.renameCancel")}
          onConfirm={(name) => {
            renameRequest.resolve(name);
            setRenameRequest(null);
          }}
          onCancel={() => {
            renameRequest.resolve(null);
            setRenameRequest(null);
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsOverlay t={t} onClose={() => setShortcutsOpen(false)} />}
      {aboutOpen && <AboutDialog t={t} onClose={() => setAboutOpen(false)} />}
      {preferencesOpen && (
        <Suspense fallback={null}>
          <PreferencesDialog
            t={t}
            value={editorPrefs}
            onChange={setEditorPrefs}
            onClose={() => setPreferencesOpen(false)}
          />
        </Suspense>
      )}
      {presenting && isActiveMarp && (
        <Suspense fallback={null}>
          <PresentOverlay content={activeContent} t={t} onExit={exitPresent} />
        </Suspense>
      )}
    </>
  );
}
