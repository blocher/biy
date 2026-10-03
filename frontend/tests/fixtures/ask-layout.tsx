import { useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ReadingChatDialog } from "../../src/ReadingChat";
import type { useStudyChat } from "../../src/useStudyChat";
import "../../src/styles.css";
import "../../src/studyChat.css";
import "../../src/theme.css";
function Fixture() {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState(
    `In John 1:5, I highlighted:\n\n“${"The light shines in the darkness. ".repeat(15)}”\n\n`,
  );
  const [sent, setSent] = useState("");
  const chat = {
    question,
    setQuestion,
    edition: "bible",
    day: 1,
    saved: [],
    current: null,
    status: { configured: true, worker_online: true },
    external: false,
    setExternal: () => {},
    newConversation: () => setQuestion(""),
    send: () => setSent(question),
  } as unknown as ReturnType<typeof useStudyChat>;
  return (
    <>
      <button onClick={() => setOpen(true)}>Open Ask</button>
      <output>{sent}</output>
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
