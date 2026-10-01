import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, MessageCircle, NotebookPen, Plus, X } from "lucide-react";
import { api } from "./api";
import { NoteEditorDialog, type NoteEditorValue } from "./NoteEditorDialog";
import type { Note } from "./types";
import type { useStudyChat } from "./useStudyChat";
import {
  selectionToolbarPosition,
  type SelectionToolbarPosition,
} from "./readingSelection";

type Chat = ReturnType<typeof useStudyChat>;

type ReadingSelection = {
  quote: string;
  citation: string;
  sourceUrl: string;
};

function localUrl(fragment = "") {
  return `${window.location.pathname}${window.location.search}${fragment}`;
}

function selectionSource(node: Node | null, fallback: string) {
  const element =
    node instanceof Element ? node : node?.parentElement || undefined;
  const source = element?.closest<HTMLElement>("[data-reading-citation]");
  const fragment = source?.dataset.readingUrl || "";
  return {
    citation: source?.dataset.readingCitation || fallback,
    sourceUrl: fragment.startsWith("/") ? fragment : localUrl(fragment),
  };
}

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
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  const [toolbar, setToolbar] = useState<SelectionToolbarPosition | null>(null);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const hide = () => setToolbar(null);
    const dismiss = (event: PointerEvent) => {
      const element = event.target as HTMLElement;
      if (!element.closest(".reading-selection-tools")) setToolbar(null);
      if (!element.closest(".reading-capture-launcher")) setLauncherOpen(false);
    };
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    document.addEventListener("pointerdown", dismiss);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
      document.removeEventListener("pointerdown", dismiss);
    };
  }, []);

  function readSelection() {
    const native = window.getSelection();
    if (!native || native.isCollapsed || !native.rangeCount || !surface.current)
      return false;
    const range = native.getRangeAt(0);
    if (!surface.current.contains(range.commonAncestorContainer)) return false;
    const quote = native.toString().replace(/\s+/g, " ").trim().slice(0, 10000);
    if (!quote) return false;
    const source = selectionSource(range.startContainer, contextLabel);
    const rect = range.getBoundingClientRect();
    setSelection({ quote, ...source });
    setLauncherOpen(false);
    const viewport = window.visualViewport;
    setToolbar(
      selectionToolbarPosition(
        rect,
        {
          left: viewport?.offsetLeft || 0,
          top: viewport?.offsetTop || 0,
          width: viewport?.width || window.innerWidth,
          height: viewport?.height || window.innerHeight,
        },
        window.matchMedia("(any-pointer: coarse)").matches,
      ),
    );
    return true;
  }

  function openNote() {
    setToolbar(null);
    setLauncherOpen(false);
    setSaved(false);
    setNoteOpen(true);
  }

  function openAsk() {
    chat.newConversation();
    if (selection) chat.setQuestion(buildSelectionQuestion(selection));
    setToolbar(null);
    setLauncherOpen(false);
    onOpenAsk();
  }

  async function saveNote(value: NoteEditorValue) {
    const note = await api<Note>(target + "/notes", "POST", value);
    window.dispatchEvent(new CustomEvent("biy-note-saved", { detail: note }));
    setSelection(null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 3000);
  }

  const tools = (
    <>
      {toolbar && (
        <div
          className="reading-selection-tools"
          role="toolbar"
          aria-label="Use highlighted text"
          data-placement={toolbar.placement}
          style={{
            left: toolbar.left,
            top: toolbar.top,
            maxWidth: toolbar.maxWidth,
          }}
        >
          <button onClick={openNote}>
            <NotebookPen size={16} /> Note
          </button>
          <span aria-hidden="true" />
          <button onClick={openAsk}>
            <MessageCircle size={16} /> Ask
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
            setSelection(null);
            setToolbar(null);
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
      <div
        className="reading-capture-surface"
        ref={surface}
        onPointerUp={(event) => {
          if (
            (event.target as HTMLElement).closest("button, a, input, textarea")
          )
            return;
          window.setTimeout(
            () => {
              if (!readSelection()) setToolbar(null);
            },
            event.pointerType === "touch" ? 180 : 0,
          );
        }}
        onKeyUp={(event) => {
          if (event.key.startsWith("Arrow") || event.key === "Shift")
            window.setTimeout(() => readSelection(), 0);
        }}
        onContextMenu={(event) => {
          if (
            readSelection() &&
            !window.matchMedia("(any-pointer: coarse)").matches
          )
            event.preventDefault();
        }}
      >
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
            source_url: selection?.sourceUrl || localUrl(),
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
