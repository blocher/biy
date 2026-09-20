import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Check, Trash2, Edit3, Clock } from "lucide-react";
import { api, date, time } from "./api";
import type { Note, Episode } from "./types";
import { useAudio } from "./Audio";
export function Notes({
  target,
  user,
  episode,
  onError,
}: {
  target: string;
  user: string;
  episode: Episode | null;
  onError: (e: string) => void;
}) {
  const [notes, setNotes] = useState<Note[]>([]),
    [sharedNotes, setSharedNotes] = useState<Note[]>([]),
    [shared, setShared] = useState(false),
    [body, setBody] = useState(""),
    [kind, setKind] = useState<"note" | "journal">("note"),
    [editing, setEditing] = useState<number | null>(null),
    [attach, setAttach] = useState(false),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  const location = useLocation();
  const audio = useAudio(),
    key = `biy-draft:${user}:${target}`;
  useEffect(() => {
    let live = true;
    setBody(sessionStorage.getItem(key) || "");
    setEditing(null);
    setShared(false);
    setSaved(false);
    setNotes([]);
    setSharedNotes([]);
    void api<Note[]>(
      `/shared-notes?${target.startsWith("/days/") ? "day" : "episode"}=${target.split("/").at(-1)}`,
    )
      .then((data) => {
        if (live) setSharedNotes(data);
      })
      .catch((err) => onError(err.message));
    void api<Note[]>(target + "/notes")
      .then((data) => {
        if (live) setNotes(data);
      })
      .catch((err) => onError(err.message));
    return () => {
      live = false;
    };
  }, [target, key]);
  useEffect(() => {
    const entry = [...notes, ...sharedNotes].find(
      (n) => location.hash === `#note-${n.id}`,
    );
    if (!entry) return;
    setKind(entry.kind);
    const timer = window.setTimeout(
      () =>
        document
          .getElementById(`note-${entry.id}`)
          ?.scrollIntoView({ block: "center" }),
      100,
    );
    return () => clearTimeout(timer);
  }, [notes, sharedNotes, location.hash]);
  function change(value: string) {
    setBody(value);
    setSaved(false);
    sessionStorage.setItem(key, value);
  }
  async function save() {
    setBusy(true);
    try {
      const note = await api<Note>(
        editing ? `/notes/${editing}` : target + "/notes",
        editing ? "PUT" : "POST",
        {
          body,
          kind,
          shared,
          audio_time:
            attach && audio.episode?.id === episode?.id ? audio.position : null,
        },
      );
      setNotes((current) =>
        editing
          ? current.map((n) => (n.id === editing ? note : n))
          : [note, ...current],
      );
      setBody("");
      setShared(false);
      setEditing(null);
      sessionStorage.removeItem(key);
      setSaved(true);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(note: Note) {
    if (!confirm("Delete this saved entry?")) return;
    try {
      await api(`/notes/${note.id}`, "DELETE");
      setNotes((ns) => ns.filter((n) => n.id !== note.id));
    } catch (err) {
      onError((err as Error).message);
    }
  }
  return (
    <section className="notes" aria-label="Notes and journal">
      <div className="section-heading">
        <h2>Your reflections</h2>
        <span className="quiet">Private unless marked Shared</span>
      </div>
      <div className="segmented">
        <button
          className={kind === "note" ? "active" : ""}
          onClick={() => setKind("note")}
        >
          Notes
        </button>
        <button
          className={kind === "journal" ? "active" : ""}
          onClick={() => setKind("journal")}
        >
          Journal
        </button>
      </div>
      <label className="sr-only" htmlFor="note-body">
        {kind === "journal" ? "Journal entry" : "Study note"}
      </label>
      <textarea
        id="note-body"
        value={body}
        onChange={(e) => change(e.target.value)}
        maxLength={50000}
        rows={5}
        placeholder={
          kind === "journal"
            ? "What is staying with you today? Write a reflection, a question, or a prayer…"
            : "Capture a thought, a connection, or something to return to…"
        }
      />
      <label className="share-control">
        <input
          type="checkbox"
          checked={shared}
          onChange={(e) => setShared(e.target.checked)}
        />{" "}
        Shared — visible to all signed-in members
      </label>
      <div className="note-actions">
        {episode && audio.episode?.id === episode.id && (
          <label>
            <input
              type="checkbox"
              checked={attach}
              onChange={(e) => setAttach(e.target.checked)}
            />{" "}
            Link to {time(audio.position)}
          </label>
        )}
        <button
          className="primary"
          disabled={busy || !body.trim()}
          onClick={save}
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Save " + kind}
        </button>
        {editing && (
          <button
            onClick={() => {
              setEditing(null);
              setShared(false);
              change("");
            }}
          >
            Cancel
          </button>
        )}
        {saved && (
          <span className="saved" role="status">
            <Check size={16} /> Saved
          </span>
        )}
      </div>
      <div className="note-list">
        {notes
          .filter((n) => n.kind === kind)
          .map((note) => (
            <article className="note" id={`note-${note.id}`} key={note.id}>
              <div className="note-meta">
                <span>
                  {date(note.created_at)} · {note.shared ? "Shared" : "Private"}
                </span>
                {note.audio_time !== null && episode && (
                  <button onClick={() => audio.play(episode, note.audio_time!)}>
                    <Clock size={13} />
                    {time(note.audio_time)}
                  </button>
                )}
                <button
                  aria-label="Edit entry"
                  onClick={() => {
                    setEditing(note.id);
                    change(note.body);
                    setKind(note.kind);
                    setShared(note.shared);
                  }}
                >
                  <Edit3 size={15} />
                </button>
                <button aria-label="Delete entry" onClick={() => remove(note)}>
                  <Trash2 size={15} />
                </button>
              </div>
              <p>{note.body}</p>
            </article>
          ))}
      </div>
      <section
        className="shared-reflections"
        aria-label="Community reflections"
      >
        <h2>Community reflections</h2>
        {sharedNotes.length ? (
          sharedNotes.map((note) => (
            <article className="note" id={`note-${note.id}`} key={note.id}>
              <div className="note-meta">
                <strong>{note.author.name}</strong>
                <span>
                  {note.kind} · {date(note.created_at)}
                </span>
              </div>
              <p>{note.body}</p>
            </article>
          ))
        ) : (
          <p className="quiet">No shared reflections from others here yet.</p>
        )}
      </section>
    </section>
  );
}
