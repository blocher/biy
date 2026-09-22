import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  LockKeyhole,
  MessageCircle,
  NotebookPen,
  Plus,
  X,
} from "lucide-react";
import { api } from "./api";
import type { Note } from "./types";
import type { useStudyChat } from "./useStudyChat";

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
    selection.quote.length > 3200
      ? `${selection.quote.slice(0, 3199).trimEnd()}…`
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
  const dialog = useRef<HTMLDialogElement>(null);
  const [selection, setSelection] = useState<ReadingSelection | null>(null);
  const [toolbar, setToolbar] = useState<{ left: number; top: number } | null>(
    null,
  );
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [body, setBody] = useState("");
  const [shared, setShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!noteOpen || !node) return;
    const before = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      node.close();
      document.body.style.overflow = before;
    };
  }, [noteOpen]);

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

  function readSelection(point?: { left: number; top: number }) {
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
    setToolbar(
      point || {
        left: Math.min(
          window.innerWidth - 116,
          Math.max(116, rect.left + rect.width / 2),
        ),
        top: rect.top > 72 ? rect.top - 12 : rect.bottom + 58,
      },
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

  async function saveNote(event: React.FormEvent) {
    event.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      const note = await api<Note>(target + "/notes", "POST", {
        body: body.trim(),
        kind: "note",
        shared,
        audio_time: null,
        quote: selection?.quote || "",
        citation: selection?.citation || contextLabel,
        source_url: selection?.sourceUrl || localUrl(),
      });
      window.dispatchEvent(new CustomEvent("biy-note-saved", { detail: note }));
      setBody("");
      setShared(false);
      setSelection(null);
      setNoteOpen(false);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const tools = (
    <>
      {toolbar && (
        <div
          className="reading-selection-tools"
          role="toolbar"
          aria-label="Use highlighted text"
          style={{ left: toolbar.left, top: toolbar.top }}
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
          if (readSelection({ left: event.clientX, top: event.clientY }))
            event.preventDefault();
        }}
      >
        {children}
      </div>
      {createPortal(tools, document.body)}
      {createPortal(
        <dialog
          ref={dialog}
          className="reading-note-dialog"
          aria-labelledby="reading-note-title"
          onCancel={() => setNoteOpen(false)}
          onClose={() => setNoteOpen(false)}
        >
          {noteOpen && (
            <form onSubmit={saveNote}>
              <header>
                <div>
                  <span className="eyebrow">CAPTURE THIS MOMENT</span>
                  <h2 id="reading-note-title">Save a note</h2>
                </div>
                <button
                  type="button"
                  aria-label="Close note"
                  onClick={() => setNoteOpen(false)}
                >
                  <X size={21} />
                </button>
              </header>
              {selection && (
                <blockquote className="reading-note-selection">
                  <cite>{selection.citation}</cite>
                  <p>“{selection.quote}”</p>
                </blockquote>
              )}
              <label htmlFor="reading-note-body">Your note</label>
              <textarea
                id="reading-note-body"
                autoFocus
                rows={6}
                maxLength={50000}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder="What caught your attention?"
              />
              <div className="reading-note-privacy">
                <LockKeyhole size={15} />
                <span>
                  {shared ? "Shared with signed-in members" : "Private to you"}
                </span>
                <label>
                  <input
                    type="checkbox"
                    checked={shared}
                    onChange={(event) => setShared(event.target.checked)}
                  />{" "}
                  Share
                </label>
              </div>
              <footer>
                <button type="button" onClick={() => setNoteOpen(false)}>
                  Cancel
                </button>
                <button className="primary" disabled={saving || !body.trim()}>
                  {saving ? "Saving…" : "Save note"}
                </button>
              </footer>
            </form>
          )}
        </dialog>,
        document.body,
      )}
    </>
  );
}
