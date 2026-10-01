import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, MessageCircle, NotebookPen, Plus, X } from "lucide-react";
import { api } from "./api";
import { NoteEditorDialog, type NoteEditorValue } from "./NoteEditorDialog";
import type { Note } from "./types";
import type { useStudyChat } from "./useStudyChat";
import type { ReadingSelection } from "./readingSelection";
import { localReadingUrl, useReadingSelection } from "./useReadingSelection";

type Chat = ReturnType<typeof useStudyChat>;

export function buildSelectionQuestion(selection: ReadingSelection) {
  const quote =
    selection.quote.length > 600
      ? `${selection.quote.slice(0, 599).trimEnd()}…`
      : selection.quote;
  return `In ${selection.citation}, I highlighted:\n\n“${quote}”\n\nWhat should I notice here?`;
}

export function ReadingCapture({
  children,
  target,
  contextLabel,
  chat,
  onOpenAsk,
  onError,
}: {
  children: ReactNode;
  target: string;
  contextLabel: string;
  chat: Chat;
  onOpenAsk: () => void;
  onError: (message: string) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const { selection, snapshot, toolbar, suspend, dismiss } =
    useReadingSelection(surface, contextLabel, target);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef(0);

  useEffect(() => {
    const closeLauncher = (event: PointerEvent) => {
      if (
        !(event.target instanceof Element) ||
        !event.target.closest(".reading-capture-launcher")
      )
        setLauncherOpen(false);
    };
    document.addEventListener("pointerdown", closeLauncher);
    return () => {
      document.removeEventListener("pointerdown", closeLauncher);
      window.clearTimeout(savedTimer.current);
    };
  }, []);

  useEffect(() => {
    if (selection) setLauncherOpen(false);
  }, [selection]);

  function openNote() {
    suspend();
    setLauncherOpen(false);
    setSaved(false);
    setNoteOpen(true);
  }

  function openAsk() {
    chat.newConversation();
    if (snapshot.current)
      chat.setQuestion(buildSelectionQuestion(snapshot.current));
    suspend();
    setLauncherOpen(false);
    onOpenAsk();
  }

  async function saveNote(value: NoteEditorValue) {
    const note = await api<Note>(target + "/notes", "POST", value);
    window.dispatchEvent(new CustomEvent("biy-note-saved", { detail: note }));
    dismiss();
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 3000);
  }

  const tools = (
    <>
      {toolbar && (
        <div
          className="reading-selection-tools"
          role="toolbar"
          aria-label="Use highlighted text"
          data-placement={toolbar.placement}
          onPointerDown={(event) => {
            // Mouse activation should not clear the browser highlight before click.
            // Touch activation uses the snapshot even if Safari collapses its range.
            if (event.pointerType === "mouse") event.preventDefault();
          }}
          style={{
            left: toolbar.left,
            top: toolbar.top,
            maxWidth: toolbar.maxWidth,
          }}
        >
          <button onClick={openNote}>
            <NotebookPen size={16} /> Take note
          </button>
          <span aria-hidden="true" />
          <button onClick={openAsk}>
            <MessageCircle size={16} /> Ask
          </button>
          <button
            className="reading-selection-dismiss"
            aria-label="Dismiss selection tools"
            onClick={dismiss}
          >
            <X size={16} />
          </button>
        </div>
      )}
      <div className="reading-capture-launcher">
        {launcherOpen && (
          <div className="reading-capture-menu" role="menu">
            <button role="menuitem" onClick={openNote}>
              <NotebookPen size={17} /> Take a note
            </button>
            <button role="menuitem" onClick={openAsk}>
              <MessageCircle size={17} /> Ask about this reading
            </button>
          </div>
        )}
        <button
          className="reading-capture-fab"
          aria-label={
            launcherOpen ? "Close reading tools" : "Open reading tools"
          }
          aria-expanded={launcherOpen}
          title="Note or ask without losing your place"
          onClick={() => {
            dismiss();
            setLauncherOpen((open) => !open);
          }}
        >
          {launcherOpen ? <X size={22} /> : <Plus size={24} />}
        </button>
      </div>
      {saved && (
        <div className="reading-capture-saved" role="status">
          <Check size={16} /> Saved to your notes
        </div>
      )}
    </>
  );

  return (
    <>
      <div className="reading-capture-surface" ref={surface}>
        {children}
      </div>
      {createPortal(tools, document.body)}
      {createPortal(
        <NoteEditorDialog
          open={noteOpen}
          mode="create"
          value={{
            body: "",
            kind: "note",
            shared: false,
            audio_time: null,
            quote: selection?.quote || "",
            citation: selection?.citation || contextLabel,
            source_url: selection?.sourceUrl || localReadingUrl(),
          }}
          onClose={() => setNoteOpen(false)}
          onSave={saveNote}
          onError={onError}
        />,
        document.body,
      )}
    </>
  );
}
