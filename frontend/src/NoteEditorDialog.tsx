import { useId, useLayoutEffect, useRef, useState } from "react";
import { LockKeyhole, Trash2, X } from "lucide-react";
import type { Note } from "./types";
import { useMobileDialogViewport } from "./useMobileDialogViewport";

export type NoteEditorValue = Pick<
  Note,
  | "body"
  | "kind"
  | "shared"
  | "audio_time"
  | "quote"
  | "citation"
  | "source_url"
>;

export function noteEditorValue(note: Note): NoteEditorValue {
  return {
    body: note.body,
    kind: note.kind,
    shared: note.shared,
    audio_time: note.audio_time,
    quote: note.quote,
    citation: note.citation,
    source_url: note.source_url,
  };
}

export function NoteEditorDialog({
  open,
  value,
  mode,
  onClose,
  onSave,
  onDelete,
  onError,
}: {
  open: boolean;
  value: NoteEditorValue;
  mode: "create" | "edit";
  onClose: () => void;
  onSave: (value: NoteEditorValue) => Promise<void>;
  onDelete?: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  useMobileDialogViewport(dialog, open);
  const fieldId = useId();
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState<"save" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    setDraft(value);
    setBusy(null);
    setConfirmDelete(false);
  }, [
    open,
    value.audio_time,
    value.body,
    value.citation,
    value.kind,
    value.quote,
    value.shared,
    value.source_url,
  ]);

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const before = document.body.style.overflow;
    node.showModal();
    editor.current?.focus({ preventScroll: true });
    // Draft resets on opening; place the caret after that render has committed.
    const frame = requestAnimationFrame(() => {
      const input = editor.current;
      if (input)
        input.setSelectionRange(input.value.length, input.value.length);
    });
    document.body.style.overflow = "hidden";
    return () => {
      cancelAnimationFrame(frame);
      node.close();
      document.body.style.overflow = before;
    };
  }, [open]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.body.trim() || busy) return;
    setBusy("save");
    try {
      await onSave({ ...draft, body: draft.body.trim() });
      onClose();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!onDelete || busy) return;
    setBusy("delete");
    try {
      await onDelete();
      onClose();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const noun = draft.kind === "journal" ? "journal entry" : "note";

  return (
    <dialog
      ref={dialog}
      className="reading-note-dialog"
      aria-labelledby={`${fieldId}-title`}
      onCancel={onClose}
    >
      {open && (
        <form onSubmit={save}>
          <header>
            <div>
              <span className="eyebrow">
                {mode === "edit" ? "YOUR REFLECTION" : "CAPTURE THIS MOMENT"}
              </span>
              <h2 id={`${fieldId}-title`}>
                {mode === "edit" ? `Edit ${noun}` : "Save a note"}
              </h2>
            </div>
            <button type="button" aria-label="Close note" onClick={onClose}>
              <X size={21} />
            </button>
          </header>
          {mode === "edit" && (
            <div className="segmented note-kind-switch" aria-label="Entry type">
              <button
                type="button"
                className={draft.kind === "note" ? "active" : ""}
                aria-pressed={draft.kind === "note"}
                onClick={() => setDraft({ ...draft, kind: "note" })}
              >
                Note
              </button>
              <button
                type="button"
                className={draft.kind === "journal" ? "active" : ""}
                aria-pressed={draft.kind === "journal"}
                onClick={() => setDraft({ ...draft, kind: "journal" })}
              >
                Journal
              </button>
            </div>
          )}
          {(draft.quote || draft.citation) && (
            <details className="reading-note-context">
              <summary>From {draft.citation || "this reading"}</summary>
              <blockquote className="reading-note-selection">
                {draft.citation && <cite>{draft.citation}</cite>}
                {draft.quote && <p>“{draft.quote}”</p>}
              </blockquote>
            </details>
          )}
          <label htmlFor={`${fieldId}-body`}>Your {noun}</label>
          <textarea
            ref={editor}
            id={`${fieldId}-body`}
            rows={6}
            maxLength={50000}
            value={draft.body}
            onChange={(event) =>
              setDraft({ ...draft, body: event.target.value })
            }
            placeholder="What caught your attention?"
          />
          <div className="reading-note-privacy">
            <LockKeyhole size={15} />
            <span>
              {draft.shared
                ? "Shared with signed-in members"
                : "Private to you"}
            </span>
            <label>
              <input
                type="checkbox"
                checked={draft.shared}
                onChange={(event) =>
                  setDraft({ ...draft, shared: event.target.checked })
                }
              />{" "}
              Share
            </label>
          </div>
          {confirmDelete ? (
            <div className="note-delete-confirmation" role="alert">
              <span>Delete this {noun}? This cannot be undone.</span>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                disabled={!!busy}
              >
                Keep it
              </button>
              <button
                type="button"
                className="danger"
                onClick={remove}
                disabled={!!busy}
              >
                {busy === "delete" ? "Deleting…" : "Delete"}
              </button>
            </div>
          ) : (
            <footer>
              {onDelete && (
                <button
                  type="button"
                  className="delete-note"
                  onClick={() => setConfirmDelete(true)}
                  disabled={!!busy}
                >
                  <Trash2 size={16} /> Delete
                </button>
              )}
              <button type="button" onClick={onClose} disabled={!!busy}>
                Cancel
              </button>
              <button
                className="primary"
                disabled={!!busy || !draft.body.trim()}
              >
                {busy === "save"
                  ? "Saving…"
                  : mode === "edit"
                    ? "Save changes"
                    : "Save note"}
              </button>
            </footer>
          )}
        </form>
      )}
    </dialog>
  );
}
