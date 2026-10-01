import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ReadingCapture } from "../../src/ReadingCapture";
import type { useStudyChat } from "../../src/useStudyChat";
import "../../src/styles.css";

// Summary and outline intentionally live outside ReadingCapture. Find on page
// searches the rendered page, rather than just the main reading's DOM subtree.
function Fixture() {
  const [day, setDay] = useState(1);
  const [mounted, setMounted] = useState(true);
  const chat = {
    newConversation: () => {},
    setQuestion: () => {},
  } as unknown as ReturnType<typeof useStudyChat>;
  return (
    <>
      <style>{`
        html { scroll-behavior: auto !important; }
        body { margin: 0; background: #fff; color: #111; }
        .find-fixture { max-width: 820px; padding: 90px 24px 200px; margin: auto; }
        .find-fixture p, .find-fixture li, .find-fixture button, .find-fixture summary {
          font-family: Arial, sans-serif; font-size: 20px; line-height: 1.6;
        }
        .find-fixture h1 { font-size: 28px; }
        .fixture-controls { display: flex; gap: 8px; flex-wrap: wrap; }
        #nested-scroll { height: 290px; overflow: auto; border: 2px solid #888; padding: 12px; margin-top: 50px; }
        #geometry-line { margin: 90px 0; line-height: 1.8; }
        #geometry-word { white-space: nowrap; }
        #reveal-on-resize { display: none; }
        @media (max-width: 600px) { #reveal-on-resize { display: block; } }
      `}</style>
      <div className="find-fixture">
        <h1>Find on page regression</h1>
        <div className="fixture-controls" data-page-find-ignore>
          <button onClick={() => setDay((current) => current + 1)}>Change reading target</button>
          <button onClick={() => setMounted(false)}>Unmount reading</button>
        </div>
        <section aria-label="Reading summary">
          <p id="summary-match">The summary beacon shines.</p>
        </section>
        <nav aria-label="Reading outline">
          <ol><li id="outline-match">The outline beacon guides.</li></ol>
        </nav>
        {mounted && <ReadingCapture
          target={`/days/${day}`}
          contextLabel={`Day ${day}`}
          chat={chat}
          onOpenAsk={() => {}}
          onError={(message) => { throw new Error(message); }}
        >
          <main>
            <p id="main-match">The main beacon illuminates.</p>
            <button id="button-match">A visible beacon action</button>
            <p hidden>Hidden beacon</p>
            <div style={{ display: "none" }}><p>Display-none beacon</p></div>
            <div style={{ visibility: "hidden" }}><p>Visibility-hidden beacon</p></div>
            <p aria-hidden="true">Aria-hidden beacon</p>
            <p style={{ opacity: 0 }}>Transparent beacon</p>
            <details id="details-match">
              <summary>Open extra reading</summary>
              <p id="details-text">A disclosed beacon appears.</p>
            </details>
            <p id="mutation-target">Mutable text starts without the search term.</p>
            <p id="style-target" style={{ display: "none" }}>Newly visible beacon</p>
            <p id="split-inline">Read the <strong>living</strong> <em>word</em> together.</p>
            <p><span id="inline-block-start" style={{ display: "inline-block" }}>sun</span><span id="inline-block-end">rise</span></p>
            <p><span style={{ display: "contents" }}><strong id="contents-start">moon</strong></span><span id="contents-end">beam</span></p>
            <p><span id="break-start">quiet</span><br /><span id="break-end">waters</span></p>
            <div style={{ visibility: "hidden" }}><p id="visibility-override" style={{ visibility: "visible" }}>revealedword</p></div>
            <p id="unicode-text">İ 🕯️ Saint Jérôme finds café and TARGET after Unicode.</p>
            <p id="reveal-on-resize">responsiveword</p>
            <div style={{ height: 350 }} aria-hidden="true" />
            <div id="nested-scroll">
              <div style={{ height: 240 }} aria-hidden="true" />
              <p id="geometry-line">Text before the <span id="geometry-word">lighthouse</span> and text after it, which wraps when the reading font grows.</p>
              <div style={{ height: 550 }} aria-hidden="true" />
            </div>
            <div id="long-scroll" style={{ height: 220, overflow: "auto", marginTop: 80, padding: 12, border: "2px solid #888" }}>
              <p id="long-paragraph">{"ordinary reading ".repeat(500) + "deepword" + " ordinary reading".repeat(15)}</p>
            </div>
            <div style={{ height: 700 }} aria-hidden="true" />
          </main>
        </ReadingCapture>}
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode><BrowserRouter><Fixture /></BrowserRouter></StrictMode>,
);
