import { History, Pause, Play, ArrowUpRight, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { api, time } from "./api";
import type { PreviousReading } from "./previousReading";
import type {
  DayDetail,
  Scripture as Passage,
  ScriptureAudioCue,
} from "./types";
import "./catechismReferences.css";

function verseAnchor(book: string, chapter: number, verse: number) {
  return `verse-${book.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${chapter}-${verse}`;
}

type ScriptureAudio = {
  episodeActive: boolean;
  position: number;
  playing: boolean;
  playAll: () => void;
  playPassage: (cue: ScriptureAudioCue) => void;
  toggle: () => void;
};

export function Scripture({
  passages,
  audio,
  toolbar = true,
  previous,
}: {
  passages: Passage[];
  audio?: ScriptureAudio;
  toolbar?: boolean;
  previous?: (PreviousScripture | null)[];
}) {
  const [peek, setPeek] = useState<{
    reading: PreviousScripture;
    readingSize: string;
  } | null>(null);
  const cues = passages.flatMap((passage) =>
    passage.audio ? [passage.audio] : [],
  );
  const currentCue = cues.find(
    (cue) =>
      audio?.episodeActive &&
      audio.position >= cue.start &&
      audio.position < cue.end,
  );
  const totalSeconds = cues.reduce(
    (total, cue) => total + cue.end - cue.start,
    0,
  );
  return (
    <div className="scripture-text">
      {audio && cues.length > 0 && toolbar && (
        <div className="scripture-audio-bar">
          <button
            className="scripture-audio-primary"
            onClick={() => (currentCue ? audio.toggle() : audio.playAll())}
          >
            <span className="scripture-audio-icon">
              {currentCue && audio.playing ? (
                <Pause size={17} />
              ) : (
                <Play size={17} />
              )}
            </span>
            <span>
              <strong>
                {currentCue
                  ? audio.playing
                    ? "Pause Scripture"
                    : "Resume Scripture"
                  : "Play Scripture"}
              </strong>
              <small>
                {cues.length === passages.length
                  ? `${cues.length} ${cues.length === 1 ? "reading" : "readings"}`
                  : `${cues.length} of ${passages.length} readings available`}
                {" · "}
                {time(totalSeconds)}
              </small>
            </span>
          </button>
        </div>
      )}
      {passages.map((passage, index) => (
        <section
          key={passage.reference}
          id={`passage-${index}`}
          className="passage"
        >
          <div className="passage-heading">
            <div>
              <span className="eyebrow">THE WORD</span>
              <h2>{passage.reference}</h2>
            </div>
            {audio && passage.audio && (
              <button
                className="passage-audio-button"
                aria-label={`${currentCue === passage.audio && audio.playing ? "Pause" : "Play"} ${passage.reference}`}
                onClick={() =>
                  currentCue === passage.audio
                    ? audio.toggle()
                    : audio.playPassage(passage.audio!)
                }
              >
                {currentCue === passage.audio && audio.playing ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}
                <span>
                  {currentCue === passage.audio && audio.playing
                    ? "Pause passage"
                    : "Play passage"}
                </span>
              </button>
            )}
          </div>
          {passage.groups.map((group, gi) =>
            group.missing ? (
              <p className="empty" key={gi}>
                This passage hasn’t been imported yet.
              </p>
            ) : (
              <div key={gi}>
                {[...new Set(group.verses.map((v) => v.chapter))].map((ch, ci) => (
                  <div className="chapter" key={ch}>
                    <h3>
                      {group.book} <span>{ch}</span>
                      {gi === 0 && ci === 0 && previous?.[index] && (
                        <button
                          className="previous-reading-button"
                          aria-label={`Where you left off in ${group.book}: Day ${previous[index]!.day}, ${previous[index]!.reference}`}
                          title={`Where you left off · Day ${previous[index]!.day}`}
                          onClick={(event) =>
                            setPeek({
                              reading: previous[index]!,
                              readingSize: getComputedStyle(
                                event.currentTarget,
                              ).getPropertyValue("--reading-size"),
                            })
                          }
                        >
                          <History size={13} />
                        </button>
                      )}
                    </h3>
                    <div>
                      {group.verses
                        .filter((v) => v.chapter === ch)
                        .map((v) => (
                          <p
                            id={verseAnchor(group.book, v.chapter, v.verse)}
                            data-reading-citation={`${group.book} ${v.chapter}:${v.verse}`}
                            data-reading-url={`#${verseAnchor(group.book, v.chapter, v.verse)}`}
                            className={
                              "verse-paragraph " +
                              (group.book === "Psalm" || v.text.includes("\n")
                                ? "poetry"
                                : "")
                            }
                            key={v.verse}
                          >
                            <span className="verse">
                              <sup>{v.verse}</sup>{" "}
                              {v.text}
                            </span>
                          </p>
                        ))}
                    </div>
                  </div>
                ))}
              </div>
            ),
          )}
        </section>
      ))}
      <p className="edition-note">
        Revised Standard Version, Second Catholic Edition. Bible text © 2000,
        2003, 2006 National Council of the Churches of Christ in the USA.
        Imported from your Catholic Study Bible.
      </p>
      {peek && (
        <PreviousReadingDialog
          reading={peek.reading}
          readingSize={peek.readingSize}
          close={() => setPeek(null)}
        />
      )}
    </div>
  );
}

export type PreviousScripture = PreviousReading & { url: string };

// Scripture text never varies by reader, so earlier passages are shared.
const previousPassages = new Map<number, Passage[]>();

/** Shows the end of an earlier reading without leaving today's passage. */
function PreviousReadingDialog({
  reading,
  readingSize,
  close,
}: {
  reading: PreviousScripture;
  readingSize: string;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    body = useRef<HTMLDivElement>(null);
  const [passages, setPassages] = useState(
      () => previousPassages.get(reading.day) || null,
    ),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const passage = passages?.[reading.index];
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node) return;
    node.showModal();
    return () => node.close();
  }, []);
  useEffect(() => {
    if (passages) return;
    let live = true;
    setError("");
    api<DayDetail>(`/days/${reading.day}?edition=bible`)
      .then((day) => {
        previousPassages.set(reading.day, day.scripture);
        if (live) setPassages(day.scripture);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [passages, reading.day, retry]);
  useLayoutEffect(() => {
    if (passage && body.current)
      body.current.scrollTop = body.current.scrollHeight;
  }, [passage]);
  const lastGroup = passage?.groups.filter((group) => group.verses.length).at(-1),
    lastVerse = lastGroup?.verses.at(-1);
  const contextUrl =
    lastGroup && lastVerse
      ? `${reading.url}#${verseAnchor(lastGroup.book, lastVerse.chapter, lastVerse.verse)}`
      : reading.url;
  return createPortal(
    <dialog
      ref={dialog}
      className="ccc-reference-panel previous-reading-panel"
      aria-labelledby="previous-reading-title"
      style={
        readingSize
          ? ({ "--reading-size": readingSize } as React.CSSProperties)
          : undefined
      }
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < rect.left ||
          e.clientX > rect.right ||
          e.clientY < rect.top ||
          e.clientY > rect.bottom
        )
          close();
      }}
    >
      <header className="ccc-panel-header">
        <h2 id="previous-reading-title">
          <span className="eyebrow">Where you left off · Day {reading.day}</span>
          {reading.reference}
        </h2>
        <button aria-label="Close previous reading" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <div ref={body} className="ccc-panel-body scripture-text">
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
          </div>
        ) : !passages ? (
          <p role="status">Loading Day {reading.day}…</p>
        ) : !passage ? (
          <p className="empty">This reading isn’t available.</p>
        ) : (
          passage.groups.map((group, gi) =>
            group.missing ? (
              <p className="empty" key={gi}>
                This passage hasn’t been imported yet.
              </p>
            ) : (
              [...new Set(group.verses.map((v) => v.chapter))].map((ch) => (
                <div className="chapter" key={`${gi}-${ch}`}>
                  <h3>
                    {group.book} <span>{ch}</span>
                  </h3>
                  {group.verses
                    .filter((v) => v.chapter === ch)
                    .map((v) => (
                      <p
                        className={
                          "verse-paragraph " +
                          (group.book === "Psalm" || v.text.includes("\n")
                            ? "poetry"
                            : "")
                        }
                        key={v.verse}
                      >
                        <span className="verse">
                          <sup>{v.verse}</sup> {v.text}
                        </span>
                      </p>
                    ))}
                </div>
              ))
            ),
          )
        )}
      </div>
      <footer className="ccc-panel-footer">
        <Link to={contextUrl} onClick={close}>
          Open Day {reading.day} <ArrowUpRight size={15} />
        </Link>
      </footer>
    </dialog>,
    document.body,
  );
}
