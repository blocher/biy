import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { ReadingCapture } from "../../src/ReadingCapture";
import type { useStudyChat } from "../../src/useStudyChat";
import "../../src/styles.css";

function Fixture() {
  const [mounted, setMounted] = useState(true);
  const [day, setDay] = useState(1);
  const [question, setQuestion] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const chat = {
    newConversation: () => setQuestion(""),
    setQuestion,
  } as unknown as ReturnType<typeof useStudyChat>;
  return (
    <>
      <header style={{ padding: 16 }}>
        <button onClick={() => setMounted(false)}>Unmount reading</button>
        <button onClick={() => setDay(day + 1)}>Navigate reading</button>
      </header>
      {mounted && (
        <ReadingCapture
          target={`/days/${day}`}
          contextLabel={`Day ${day}`}
          chat={chat}
          onOpenAsk={() => setAskOpen(true)}
          onError={(message) => {
            throw new Error(message);
          }}
        >
          <main
            style={{
              padding: "60px 24px 1200px",
              maxWidth: 760,
              margin: "auto",
            }}
          >
            <h1>Reading tools</h1>
            <p
              id="upper"
              tabIndex={0}
              data-reading-citation="John 1:5"
              data-reading-url="#verse-john-1-5"
              style={{ fontSize: 21, lineHeight: 1.8 }}
            >
              The light shines in the darkness, and the darkness has not
              overcome it.
            </p>
            <p
              id="lower"
              data-reading-citation="John 1:9"
              data-reading-url="/bible/day/1/reader#verse-john-1-9"
              style={{ marginTop: 240, fontSize: 21, lineHeight: 1.8 }}
            >
              The true light, which enlightens every man, was coming into the
              world.
            </p>
          </main>
        </ReadingCapture>
      )}
      {askOpen && (
        <output
          aria-label="Ask draft"
          style={{
            position: "fixed",
            inset: "80px 16px auto",
            background: "white",
            padding: 24,
          }}
        >
          {question || "No selected quote"}
        </output>
      )}
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
