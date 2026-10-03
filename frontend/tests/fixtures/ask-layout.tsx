import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { buildSelectionQuestion } from "../../src/ReadingCapture";
import { NoteEditorDialog } from "../../src/NoteEditorDialog";
import { ReadingChatDialog } from "../../src/ReadingChat";
import type { useStudyChat } from "../../src/useStudyChat";
import "../../src/styles.css";
import "../../src/studyChat.css";
import "../../src/theme.css";
function Fixture() {
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("A thought to continue.");
  const [external, setExternal] = useState(false);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(
    buildSelectionQuestion({
      quote: "The light shines in the darkness.",
      citation: "John 1:5",
      sourceUrl: "/bible/day/1",
    }),
  );
  const [sent, setSent] = useState("");
  const chat = {
    question,
    setQuestion,
    edition: "bible",
    day: 1,
    saved: [],
    current: sent
      ? {
          id: 1,
          turns: [
            {
              id: 1,
              question: sent,
              answer: "An answer to your question.",
              status: "complete",
              sources: [],
              notices: [],
              follow_ups: ["Tell me more about this passage."],
            },
          ],
        }
      : null,
    status: {
      configured: true,
      worker_online: true,
      magisterium_configured: true,
    },
    external,
    setExternal,
    newConversation: () => {
      setQuestion("");
      setSent("");
    },
    send: () => {
      setSent(question);
      setQuestion("");
    },
  } as unknown as ReturnType<typeof useStudyChat>;
  return (
    <>
      <button onClick={() => setOpen(true)}>Open Ask</button>
      <button onClick={() => setNoteOpen(true)}>Open note</button>
      <output>{sent}</output>
      <NoteEditorDialog
        open={noteOpen}
        value={{
          body: noteBody,
          kind: "note",
          shared: false,
          audio_time: null,
          quote: "The light shines in the darkness.",
          citation: "John 1:5",
          source_url: "/bible/day/1",
        }}
        mode="edit"
        onClose={() => setNoteOpen(false)}
        onSave={async (value) => {
          setNoteBody(value.body);
        }}
        onError={(error) => {
          throw Error(error);
        }}
      />
      <ReadingChatDialog
        open={open}
        onClose={() => setOpen(false)}
        chat={chat}
        readings="Genesis 25–26 · Job 15–16 · Proverbs 2:20–22"
      />
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
