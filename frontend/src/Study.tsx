import { ThemeToggle } from "./Theme";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Headphones,
  MessageCircle,
  Maximize2,
  Pause,
  Play,
  BookOpen,
  ChevronDown,
  Minus,
  Plus,
  Pencil,
  X,
} from "lucide-react";
import {
  api,
  date,
  dateInputValue,
  episodeTitle,
  shortDate,
  time,
} from "./api";
import type {
  DayDetail,
  Episode,
  Library,
  ScriptureAudioCue,
  Segment,
} from "./types";
import { Design } from "./Design";
import studySource from "./design/study.html?raw";
import readerSource from "./design/reader.html?raw";
import { useAudio } from "./Audio";
import { Notes } from "./Notes";
import { Scripture } from "./Scripture";
import { Catechism } from "./Catechism";
import { Sidebar } from "./navigation";
import { useStudyChat } from "./useStudyChat";
import { ReadingChatDialog, ReadingChatHistory } from "./ReadingChat";
import { ReadingCapture } from "./ReadingCapture";
import { editionName, useEdition } from "./Edition";
import {
  audioSpanContaining,
  audioSpanDuration,
  groupTranscriptSegments,
  mergeAudioSpans,
  plainOutlineTitle,
  supplementarySpeakerNames,
} from "./studyText";

export function Study(props: ComponentProps<typeof StudyContent>) {
  const params = useParams();
  return (
    <StudyContent
      key={`${props.user}:${params.edition}:${params.day || ""}:${params.episode || ""}`}
      {...props}
    />
  );
}

function StudyContent({
  user,
  completedDays,
  onError,
  onChange,
  reader = false,
}: {
  user: string;
  completedDays: number;
  onError: (e: string) => void;
  onChange: () => void;
  reader?: boolean;
}) {
  const { edition, availability, setEdition } = useEdition();
  const params = useParams(),
    isDay = !!params.day,
    target = isDay ? `/days/${params.day}` : `/episodes/${params.episode}`;
  const chat = useStudyChat({
    day: isDay ? Number(params.day) : null,
    episode: isDay ? null : Number(params.episode),
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [data, setData] = useState<DayDetail | Episode | null>(null),
    [failure, setFailure] = useState(""),
    [search, setSearch] = useSearchParams(),
    [size, setSize] = useState(
      () => Number(localStorage.getItem("biy-font-size")) || 20,
    ),
    [saving, setSaving] = useState(false),
    [completionOpen, setCompletionOpen] = useState(false),
    [otherNextDay, setOtherNextDay] = useState<number | null>(null),
    [otherLoading, setOtherLoading] = useState(false),
    [keyPointsOpen, setKeyPointsOpen] = useState(true),
    [editingCompletionDate, setEditingCompletionDate] = useState(false);
  const navigate = useNavigate(),
    tab =
      search.get("tab") ||
      (edition === "catechism" ? "catechism" : "scripture"),
    audio = useAudio();
  const completionDialog = useRef<HTMLDialogElement>(null);
  const otherEdition = edition === "bible" ? "catechism" : "bible";
  useLayoutEffect(() => {
    const dialog = completionDialog.current;
    if (!completionOpen || !dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, [completionOpen]);
  useEffect(() => {
    let live = true;
    setData(null);
    setFailure("");
    api<DayDetail | Episode>(target)
      .then((result) => {
        if (live) setData(result);
      })
      .catch((e) => {
        if (live) setFailure(e.message);
      });
    return () => {
      live = false;
    };
  }, [target]);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [target, reader]);
  useLayoutEffect(() => {
    if (reader && !window.location.hash) window.scrollTo(0, 0);
  }, [reader, tab]);
  useEffect(() => {
    const before = document.title;
    document.title = data
      ? `${isDay ? `Day ${(data as DayDetail).number}` : episodeTitle((data as Episode).title)} · ${editionName(edition)}`
      : editionName(edition);
    return () => {
      document.title = before;
    };
  }, [data, edition, isDay]);
  useEffect(() => {
    if (!data || !location.hash) return;
    const timer = window.setTimeout(
      () =>
        document
          .getElementById(location.hash.slice(1))
          ?.scrollIntoView({ block: "center" }),
      150,
    );
    return () => clearTimeout(timer);
  }, [data, tab]);
  if (failure)
    return (
      <div className="app-frame">
        <Sidebar user={user} />
        <main className="simple-page">
          <h1>Couldn’t open this study</h1>
          <p role="alert">{failure}</p>
          <Link to={`/${edition}`}>Back to reading plan</Link>
        </main>
      </div>
    );
  if (!data)
    return (
      <div className="app-frame">
        <Sidebar user={user} />
        <main className="simple-page">
          <p role="status">Opening your study…</p>
        </main>
      </div>
    );
  const day = isDay ? (data as DayDetail) : null,
    episode = day ? day.episode : (data as Episode),
    base = day ? `/${edition}/day/${day.number}` : `/${edition}/episode/${episode!.id}`;
  const title = episode ? episodeTitle(episode.title) : day!.readings[0],
    completed = data.completed_at;
  const supplementarySpeakers = episode
    ? supplementarySpeakerNames(episode)
    : new Map<string, string>();
  const completionPercent = Math.round((completedDays / 365) * 1000) / 10;
  const completionPercentLabel = `${Number.isInteger(completionPercent) ? completionPercent : completionPercent.toFixed(1)}%`;
  async function complete() {
    setSaving(true);
    try {
      const result = await api<{ completed_at: string | null }>(
        target + "/completion",
        "PUT",
        { completed: !completed },
      );
      setData((current) =>
        current ? { ...current, completed_at: result.completed_at } : current,
      );
      onChange();
      if (!completed && result.completed_at) {
        setCompletionOpen(true);
        setOtherNextDay(null);
        if (availability[otherEdition]) {
          setOtherLoading(true);
          void api<Library>(`/library?edition=${otherEdition}`)
            .then((library) => setOtherNextDay(library.next_day))
            .catch(() => setOtherNextDay(null))
            .finally(() => setOtherLoading(false));
        }
      }
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function updateCompletionDate(completed_on: string) {
    try {
      const result = await api<{ completed_at: string }>(
        `${target}/completed-at`,
        "PUT",
        { completed_on },
      );
      setData((current) =>
        current ? { ...current, completed_at: result.completed_at } : current,
      );
      setEditingCompletionDate(false);
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  const completion = (
    <button
      className={completed ? "completed-button" : "primary"}
      disabled={saving}
      onClick={complete}
    >
      <Check size={17} />
      {saving ? "Saving…" : completed ? "Completed" : "Mark complete"}
    </button>
  );
  const completionModal = createPortal(
    <dialog
      ref={completionDialog}
      className="completion-dialog"
      aria-labelledby="completion-dialog-title"
      onClose={() => setCompletionOpen(false)}
    >
      <button className="completion-dialog-close" aria-label="Close" onClick={() => setCompletionOpen(false)}><X size={20} /></button>
      <span className="completion-dialog-icon"><Check size={22} /></span>
      <h2 id="completion-dialog-title">{day ? `Day ${day.number} complete` : "Episode complete"}</h2>
      <p>Where would you like to go next?</p>
      <div className="completion-dialog-actions">
        {day && day.number < 365 && (
          <button className="primary" onClick={() => { setCompletionOpen(false); navigate(`/${edition}/day/${day.number + 1}`); }}>
            Go to next day <ArrowRight size={17} />
          </button>
        )}
        {availability[otherEdition] && (otherLoading || otherNextDay !== null) && (
          <button className="completion-dialog-secondary" disabled={otherLoading} onClick={() => {
            if (otherNextDay === null) return;
            setCompletionOpen(false);
            setEdition(otherEdition);
            navigate(`/${otherEdition}/day/${otherNextDay}`);
          }}>
            {otherLoading ? `Finding your next ${otherEdition === "bible" ? "Bible" : "Catechism"} day…` : `Go to ${otherEdition === "bible" ? "Bible" : "Catechism"} Day ${otherNextDay}`}
            {!otherLoading && <ArrowRight size={17} />}
          </button>
        )}
        <button className="completion-dialog-home" onClick={() => { setCompletionOpen(false); navigate("/"); }}>Go home</button>
      </div>
    </dialog>,
    document.body,
  );
  const empty = (
    <div className="empty-content">
      <Headphones size={28} />
      <h3>
        {episode?.status === "failed"
          ? "Study processing needs attention"
          : "Your study is waiting"}
      </h3>
      <p>
        {episode?.has_audio
          ? "The audio is ready to listen to. Transcripts, commentary, and the study guide will appear after processing."
          : `This episode has not been imported yet. You can still read the available ${edition === "catechism" ? "Catechism paragraphs" : "Scripture"} and keep notes.`}
      </p>
    </div>
  );
  function transcript(segments: Segment[] | undefined, label: string) {
    const paragraphs = groupTranscriptSegments(segments, !day);
    return paragraphs.length ? (
      <div className="transcript-list">
        {paragraphs.map((paragraph) => (
          <article
            className={
              "transcript-segment " +
              (audio.episode?.id === episode?.id &&
              audio.position >= paragraph.start &&
              audio.position < paragraph.end
                ? "current"
                : "")
            }
            id={`segment-${paragraph.segmentIds[0]}`}
            key={paragraph.segmentIds[0]}
            data-reading-citation={`${label} · ${time(paragraph.start)}`}
            data-reading-url={`#segment-${paragraph.segmentIds[0]}`}
          >
            {paragraph.segmentIds.slice(1).map((id) => (
              <span className="segment-anchor" id={`segment-${id}`} key={id} />
            ))}
            <div className="segment-meta">
              <button
                className="timestamp"
                aria-label={`Play from ${time(paragraph.start)}`}
                onClick={() => episode && audio.play(episode, paragraph.start)}
              >
                <Play size={12} />
                {time(paragraph.start)}
              </button>
              {!day && supplementarySpeakers.get(paragraph.speaker) && (
                <span>{supplementarySpeakers.get(paragraph.speaker)}</span>
              )}
              {paragraph.partial && (
                <small>Excerpt · timestamp starts this segment</small>
              )}
            </div>
            <p>{paragraph.text}</p>
          </article>
        ))}
      </div>
    ) : (
      empty
    );
  }
  const tabs = [
    [
      edition === "catechism" ? "catechism" : "scripture",
      edition === "catechism" ? "Catechism" : "Scripture",
    ],
    ["transcript", "Full transcript"],
    ["commentary", "Commentary only"],
    ["edited", "Edited commentary"],
  ].filter(([key]) => day || !["scripture", "catechism"].includes(key));
  const selected = tabs.some(([key]) => key === tab) ? tab : "transcript";
  const scriptureCues = day?.scripture.flatMap((passage) =>
    passage.audio ? [passage.audio] : [],
  );
  const readingCues =
    edition === "catechism"
      ? day?.catechism?.flatMap((paragraph) =>
          paragraph.audio ? [paragraph.audio] : [],
        )
      : scriptureCues;
  const readingClips = mergeAudioSpans(readingCues);
  const commentaryClips = mergeAudioSpans(episode?.commentary);
  const scriptureAudio =
    episode?.has_audio && readingClips.length
      ? {
          episodeActive: audio.episode?.id === episode.id && audio.clipPlayback,
          position: audio.position,
          playing: audio.playing,
          playAll: () => audio.playClips(episode, readingClips),
          playPassage: (cue: ScriptureAudioCue) =>
            audio.playClips(episode, [cue]),
          toggle: audio.toggle,
        }
      : undefined;
  const content =
    selected === "catechism" && day ? (
      day.catechism?.length ? (
        <Catechism
          paragraphs={day.catechism}
          episode={episode}
          era={day.era}
          section={day.section}
          chapter={day.chapter}
          toolbar={reader}
        />
      ) : (
        <div className="empty-content">
          <BookOpen size={28} />
          <h3>
            {day.readings.length
              ? "Catechism text unavailable"
              : "Introductory episode"}
          </h3>
          <p>
            {day.readings.length
              ? "The assigned Catechism paragraphs have not been imported yet."
              : "This numbered day introduces a new part of the Catechism and has no assigned paragraphs."}
          </p>
        </div>
      )
    ) : selected === "scripture" && day ? (
      <Scripture
        passages={day.scripture}
        audio={scriptureAudio}
        toolbar={reader}
      />
    ) : selected === "transcript" ? (
      transcript(episode?.transcript, "Full transcript")
    ) : selected === "commentary" ? (
      <>
        <p className="view-note">
          Original commentary and prayer, with {edition === "catechism" ? "Catechism" : "Scripture"} readings and
          promotional material removed. Brief quotations within the teaching are retained.
        </p>
        {transcript(episode?.commentary, "Commentary")}
      </>
    ) : (
      <>
        {episode?.edited_commentary?.length ? (
          <div className="edited-text">
            <p className="view-note">
              Lightly edited for reading. AI-assisted; compare with the original
              audio for exact wording.
            </p>
            {episode.edited_commentary.map((p, i) => (
              <section
                id={`edited-segment-${p.segment_ids[0]}`}
                key={i}
                data-reading-citation={`Edited commentary${
                  episode.transcript?.find((s) => s.id === p.segment_ids[0])
                    ? ` · ${time(
                        episode.transcript.find(
                          (s) => s.id === p.segment_ids[0],
                        )!.start,
                      )}`
                    : ""
                }`}
                data-reading-url={`#edited-segment-${p.segment_ids[0]}`}
              >
                {(() => {
                  const source = episode.transcript?.find(
                    (s) => s.id === p.segment_ids[0],
                  );
                  return source ? (
                    <div className="segment-meta">
                      <button
                        className="timestamp"
                        aria-label={`Play from ${time(source.start)}`}
                        onClick={() => audio.play(episode, source.start)}
                      >
                        <Play size={12} /> {time(source.start)}
                      </button>
                      {!day && supplementarySpeakers.get(source.speaker) && (
                        <span>{supplementarySpeakers.get(source.speaker)}</span>
                      )}
                    </div>
                  ) : null;
                })()}
                <p>{p.text}</p>
              </section>
            ))}
          </div>
        ) : (
          empty
        )}
      </>
    );
  const chatDialog = (
    <ReadingChatDialog
      chat={chat}
      open={chatOpen}
      onClose={() => setChatOpen(false)}
      readings={day?.readings.join(" · ") || title}
    />
  );
  const capturedContent = (
    <ReadingCapture
      target={target}
      contextLabel={`${day ? `Day ${day.number}` : title} · ${
        tabs.find(([id]) => id === selected)?.[1] || "Reading"
      }`}
      chat={chat}
      onOpenAsk={() => setChatOpen(true)}
      onError={onError}
    >
      {content}
    </ReadingCapture>
  );
  const readerControls = (
    <div className="reader-controls">
      <Link to={`${base}?tab=${selected}`}>
        <X size={18} /> Exit reader
      </Link>
      <nav className="reader-mode-switcher" aria-label="Reading mode section">
        <div className="reader-mode-links">
          {tabs.map(([id, label]) => (
            <Link
              key={id}
              className={selected === id ? "active" : ""}
              aria-current={selected === id ? "page" : undefined}
              to={`${base}/reader?tab=${id}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <label className="reader-mode-select">
          <span className="sr-only">Reading mode section</span>
          <select
            aria-label="Reading mode section"
            value={selected}
            onChange={(event) =>
              navigate(`${base}/reader?tab=${event.target.value}`)
            }
          >
            {tabs.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </nav>
      <div className="font-controls">
        <ThemeToggle />
        <button
          aria-label="Smaller text"
          disabled={size <= 16}
          onClick={() => {
            setSize(size - 2);
            localStorage.setItem("biy-font-size", String(size - 2));
          }}
        >
          <Minus size={16} />
        </button>
        <span>Aa</span>
        <button
          aria-label="Larger text"
          disabled={size >= 30}
          onClick={() => {
            setSize(size + 2);
            localStorage.setItem("biy-font-size", String(size + 2));
          }}
        >
          <Plus size={16} />
        </button>
      </div>
      <button className="text-link" onClick={() => setChatOpen(true)}>
        Ask about this reading
      </button>
      {completion}
    </div>
  );
  if (reader)
    return (
      <div style={{ "--reading-size": `${size}px` } as React.CSSProperties}>
        {completionModal}
        {chatDialog}
        <Design
          source={readerSource}
          className="reader-design"
          bindings={{
            "viewport-1-c-top-nav": readerControls,
            "viewport-1-c-header": (
              <>
                <span className="eyebrow">
                  {day ? `DAY ${day.number}` : "SUPPLEMENTARY EPISODE"} · READER
                </span>
                <h1>
                  {selected === "scripture" || selected === "catechism"
                    ? day?.readings.join(" and ")
                    : title}
                </h1>
              </>
            ),
            "viewport-1-c-accessibility": null,
            "viewport-1-c-passage-tabs": (
              <nav className="reader-passages">
                {selected === "catechism" &&
                  day?.catechism?.map((paragraph) => (
                    <a href={`#ccc-${paragraph.number}`} key={paragraph.number}>
                      § {paragraph.number}
                    </a>
                  ))}
                {selected === "scripture" &&
                  day?.readings.map((r, i) => (
                    <a href={`#passage-${i}`} key={r}>
                      {r}
                    </a>
                  ))}
              </nav>
            ),
            "viewport-1-c-reader": capturedContent,
            "viewport-1-c-footer-nav": (
              <div className="reader-footer-links">
                <Link className="text-link" to={`${base}?tab=${selected}`}>
                  <ArrowLeft size={16} /> Back to study
                </Link>
                {day && day.number < 365 && (
                  <Link
                    className="text-link next-day-link"
                    to={`/${edition}/day/${day.number + 1}`}
                  >
                    Next day <ArrowRight size={16} />
                  </Link>
                )}
              </div>
            ),
          }}
        />
      </div>
    );
  const bindings: Record<string, ReactNode> = {
    "viewport-1-a-app": null,
    "viewport-1-a-sidebar": <Sidebar user={user} embedded />,
    "viewport-1-a-header": (
      <>
        <Link className="back-link" to={`/${edition}`}>
          <ArrowLeft size={15} /> Reading plan
        </Link>
        <span className="quiet">
          {episode ? (
            <>
              Published {shortDate(episode.published_at)}
              {completed && (
                <>
                  {" · "}
                  {editingCompletionDate ? (
                    <input
                      autoFocus
                      aria-label="Completion date"
                      className="completion-date-input"
                      type="date"
                      defaultValue={dateInputValue(completed)}
                      onBlur={() => setEditingCompletionDate(false)}
                      onChange={(event) =>
                        updateCompletionDate(event.target.value)
                      }
                    />
                  ) : (
                    <>
                      Completed {shortDate(completed)}
                      <button
                        className="edit-completion-date"
                        aria-label="Change completion date"
                        title="Change completion date"
                        onClick={() => setEditingCompletionDate(true)}
                      >
                        <Pencil size={12} />
                      </button>
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            "Your daily companion"
          )}
        </span>
      </>
    ),
    "viewport-1-a-hero-title": (
      <>
        <span className="study-day-progress-row">
          <span
            className="eyebrow"
            style={{ color: day?.color || episode?.color }}
          >
            {day ? `DAY ${day.number} OF 365` : "SUPPLEMENTARY EPISODE"} ·{" "}
            {data.era || "BIBLE IN A YEAR"}
          </span>
          {day && (
            <span
              className="day-progress-compact"
              aria-label={`${completionPercentLabel} of daily readings completed`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <circle
                  className="track"
                  cx="12"
                  cy="12"
                  r="9"
                  pathLength="100"
                />
                <circle
                  className="value"
                  cx="12"
                  cy="12"
                  r="9"
                  pathLength="100"
                  strokeDasharray={`${completionPercent} 100`}
                />
              </svg>
              {completionPercentLabel}
            </span>
          )}
          <span className="mobile-completion">{completion}</span>
        </span>
        <h1>{title}</h1>
      </>
    ),
    "viewport-1-a-hero-meta": (
      <>
        <p>
          {day?.readings.join(" · ") || "Conversation, context, and reflection"}
        </p>
        <div className="completion-row desktop-completion">
          {completion}
          {completed && (
            <span className="quiet">Completed {date(completed)}</span>
          )}
        </div>
      </>
    ),
    "viewport-1-a-audio": (
      <div className="study-primary-actions">
        <button
          className="primary"
          disabled={!episode?.has_audio}
          onClick={() => episode && audio.play(episode)}
        >
          <Play size={17} />
          <span className="desktop-action-label">
            {episode?.position ? "Resume listening" : "Listen to episode"}
          </span>
          <span className="mobile-listen-label">
            {episode?.position ? "Resume" : "Listen"}
            <small>
              {episode?.has_audio
                ? `${Math.ceil(episode.duration / 60)} min`
                : "Unavailable"}
            </small>
          </span>
        </button>
        <div className="reading-mode-split">
          <Link
            className="reading-mode-main"
            to={`${base}/reader?tab=${selected}`}
            title={`Open ${tabs.find(([id]) => id === selected)?.[1] || "this section"} in reading mode`}
          >
            <BookOpen size={18} />
            <span className="desktop-action-label">Reading mode</span>
            <span className="mobile-action-label">Read</span>
            <ArrowRight className="reading-mode-arrow" size={16} />
          </Link>
          <label className="reading-mode-menu">
            <span className="sr-only">Open a section in reading mode</span>
            <select
              aria-label="Open a section in reading mode"
              defaultValue=""
              onChange={(event) =>
                navigate(`${base}/reader?tab=${event.target.value}`)
              }
            >
              <option value="" disabled>
                Choose a section
              </option>
              {tabs.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <ChevronDown size={17} aria-hidden="true" />
          </label>
        </div>
        <button className="study-ask-button" onClick={() => setChatOpen(true)}>
          <MessageCircle size={18} /> Ask
        </button>
        <span className="quiet study-duration">
          {episode?.has_audio
            ? `${Math.ceil(episode.duration / 60)} min`
            : "Audio not imported yet"}
        </span>
      </div>
    ),
    "viewport-1-a-summary": (
      <>
        <span className="eyebrow">AT A GLANCE</span>
        <h2>Today’s study</h2>
        <p>
          {episode?.summary ||
            `Your episode summary will appear here once the audio has been processed. ${edition === "catechism" ? "The Catechism text" : "Scripture"} and your private journal are available independently.`}
        </p>
      </>
    ),
    "viewport-1-a-outline": (
      <>
        {episode?.outline?.length ? (
          <details className="study-outline preview-panel">
            <summary>
              <span>
                <strong>Outline</strong>
                <small>Jump to a section</small>
              </span>
              <ChevronDown size={20} aria-hidden="true" />
            </summary>
            <ol className="outline">
              {episode.outline.map((item, i) => (
                <li key={i}>
                  <button onClick={() => audio.play(episode, item.start)}>
                    <span className="outline-number">{i + 1}</span>
                    <span className="outline-copy">
                      <span className="outline-label">{item.heading}</span>
                      <strong>{plainOutlineTitle(item.title)}</strong>
                      {!day && item.speaker && (
                        <span className="outline-speaker">{item.speaker}</span>
                      )}
                    </span>
                    <span className="timestamp">
                      {time(item.start)} <Play size={12} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </details>
        ) : (
          <div className="preview-panel outline-empty">
            <div className="section-heading">
              <h2>Outline</h2>
              <Headphones size={20} />
            </div>
            <p className="quiet empty">
              A clickable outline of the reading and commentary will appear once
              this episode has been processed.
            </p>
          </div>
        )}
      </>
    ),
    "viewport-1-a-transcript": (
      <details
        className="preview-panel key-points-disclosure"
        open={keyPointsOpen}
        onToggle={(event) => setKeyPointsOpen(event.currentTarget.open)}
      >
        <summary
          onClick={(event) => {
            if (!window.matchMedia("(max-width: 640px)").matches)
              event.preventDefault();
          }}
        >
          <strong>Key points</strong>
          <BookOpen
            className="key-points-desktop-icon"
            size={20}
            aria-hidden="true"
          />
          <ChevronDown
            className="key-points-mobile-icon"
            size={20}
            aria-hidden="true"
          />
        </summary>
        <div className="key-points-content">
          {episode?.key_points?.length ? (
            <ul className="key-points">
              {episode.key_points.map((point, i) => (
                <li key={i}>{point.text}</li>
              ))}
            </ul>
          ) : (
            <>
              <p className="serif">
                Key points will be generated from this episode’s teaching.
              </p>
              <p className="quiet">
                They will be grounded in the episode and available alongside the
                full transcript.
              </p>
            </>
          )}
          <button
            className="text-link"
            onClick={() => {
              setSearch({ tab: "transcript" });
              document
                .getElementById("viewport-2-b")
                ?.scrollIntoView({ behavior: "smooth" });
            }}
          >
            Open full transcript <ArrowRight size={16} />
          </button>
        </div>
      </details>
    ),
    "viewport-2-b-app": null,
    "viewport-2-b-sidebar": null,
    "viewport-2-b-hero": null,
    "viewport-2-b-header": null,
    "viewport-2-b-content": null,
    "viewport-2-b-sidebar-content": null,
    "viewport-2-b-tabs": (
      <div className="study-tabs-bar">
        <div className="study-tabs" role="tablist" aria-label="Study content">
          {tabs.map(([id, label]) => (
            <button
              role="tab"
              id={`tab-${id}`}
              aria-selected={selected === id}
              aria-controls="study-panel"
              className={selected === id ? "active" : ""}
              key={id}
              onClick={() => setSearch({ tab: id }, { replace: true })}
            >
              {label}
            </button>
          ))}
        </div>
        <StudyTabAudio
          selected={selected}
          episode={episode}
          readingClips={readingClips}
          commentaryClips={commentaryClips}
        />
      </div>
    ),
    "viewport-2-b-commentary": (
      <div id="study-panel" role="tabpanel" aria-labelledby={`tab-${selected}`}>
        <div className="content-toolbar">
          <span className="eyebrow">
            {selected === "scripture"
              ? "RSV SECOND CATHOLIC EDITION"
              : selected === "catechism"
                ? "CATECHISM OF THE CATHOLIC CHURCH"
                : selected === "edited"
                  ? "WRITTEN FOR REFLECTION"
                  : "LISTEN • READ • REFLECT"}
          </span>
          <button className="text-link" onClick={() => setChatOpen(true)}>
            Ask about this reading
          </button>
          <Link to={`${base}/reader?tab=${selected}`}>
            <Maximize2 size={15} /> Reader mode
          </Link>
        </div>
        {capturedContent}
      </div>
    ),
    "viewport-2-b-scripture-card": (
      <>
        <h2>
          {day
            ? edition === "catechism"
              ? "Today’s Catechism"
              : "Today’s Scripture"
            : "A deeper conversation"}
        </h2>
        {day ? (
          <ul className="readings-list">
            {day.readings.map((r) => (
              <li key={r}>
                <BookOpen size={16} />
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            This supplementary episode has the same study tools and private
            reflections as a daily episode.
          </p>
        )}
        <div className="study-card-links">
          <Link
            className="text-link"
            to={`${base}/reader?tab=${day ? (edition === "catechism" ? "catechism" : "scripture") : "edited"}`}
          >
            Open full-page reader <ArrowRight size={16} />
          </Link>
          {day && edition === "bible" && (
            <Link className="text-link" to={`/commentaries?day=${day.number}`}>
              Explore historical commentaries <ArrowRight size={16} />
            </Link>
          )}
        </div>
      </>
    ),
    "viewport-2-b-journal": (
      <>
        <ReadingChatHistory chat={chat} onOpen={() => setChatOpen(true)} />
        <Notes
          target={target}
          user={user}
          episode={episode}
          onError={onError}
        />
      </>
    ),
    "viewport-2-b-audio-button": (
      <div className="day-navigation">
        {day && day.number > 1 && (
          <Link to={`/${edition}/day/${day.number - 1}`}>
            <ArrowLeft size={16} /> Day {day.number - 1}
          </Link>
        )}
        {day && day.number < 365 && (
          <Link to={`/${edition}/day/${day.number + 1}`}>
            Day {day.number + 1}
            <ArrowRight size={16} />
          </Link>
        )}
      </div>
    ),
  };
  return (
    <>
      {completionModal}
      {chatDialog}
      <Design
        source={studySource}
        bindings={bindings}
        className="study-design"
      />
    </>
  );
}

function StudyTabAudio({
  selected,
  episode,
  readingClips,
  commentaryClips,
}: {
  selected: string;
  episode: Episode | null;
  readingClips: ReturnType<typeof mergeAudioSpans>;
  commentaryClips: ReturnType<typeof mergeAudioSpans>;
}) {
  const audio = useAudio();
  if (!episode?.has_audio) return null;
  const episodeActive = audio.episode?.id === episode.id;
  const readingActive = Boolean(
    episodeActive &&
    audio.clipPlayback &&
    audioSpanContaining(readingClips, audio.position),
  );
  const commentaryActive = Boolean(
    episodeActive &&
    audio.clipPlayback &&
    audioSpanContaining(commentaryClips, audio.position),
  );
  const readingDuration = audioSpanDuration(readingClips);
  const commentaryDuration = audioSpanDuration(commentaryClips);

  if (selected === "scripture" || selected === "catechism") {
    const readingName = selected === "catechism" ? "Catechism" : "Scripture";
    if (!readingClips.length) return null;
    const label = readingActive
      ? audio.playing
        ? `Pause ${readingName}`
        : `Resume ${readingName}`
      : `Play ${readingName}`;
    return (
      <div className="study-tab-audio">
        <button
          className="study-tab-audio-play"
          aria-label={label}
          onClick={() =>
            readingActive
              ? audio.toggle()
              : audio.playClips(episode, readingClips)
          }
        >
          {readingActive && audio.playing ? (
            <Pause size={13} />
          ) : (
            <Play size={13} />
          )}
        </button>
        <span className="study-tab-audio-copy">
          <strong>{label.replace(` ${readingName}`, "")}</strong>
          <small>{time(readingDuration)}</small>
        </span>
      </div>
    );
  }

  if (selected !== "transcript") return null;

  return (
    <div className="study-tab-audio">
      <button
        className="study-tab-audio-play"
        aria-label={
          episodeActive && !audio.clipPlayback && audio.playing
            ? "Pause episode"
            : "Play episode"
        }
        onClick={() =>
          episodeActive && !audio.clipPlayback
            ? audio.toggle()
            : audio.play(episode)
        }
      >
        {episodeActive && !audio.clipPlayback && audio.playing ? (
          <Pause size={13} />
        ) : (
          <Play size={13} />
        )}
      </button>
      {readingClips.length || commentaryClips.length ? (
        <span className="study-tab-audio-breakdown">
          {readingClips.length > 0 && (
            <button
              className={readingActive ? "active" : ""}
              aria-label={`${readingActive && audio.playing ? "Pause" : "Play"} reading, ${time(readingDuration)}`}
              onClick={() =>
                readingActive
                  ? audio.toggle()
                  : audio.playClips(episode, readingClips)
              }
            >
              Reading {time(readingDuration)}
            </button>
          )}
          {readingClips.length > 0 && commentaryClips.length > 0 && (
            <span aria-hidden="true">·</span>
          )}
          {commentaryClips.length > 0 && (
            <button
              className={commentaryActive ? "active" : ""}
              aria-label={`${commentaryActive && audio.playing ? "Pause" : "Play"} commentary, ${time(commentaryDuration)}`}
              onClick={() =>
                commentaryActive
                  ? audio.toggle()
                  : audio.playClips(episode, commentaryClips)
              }
            >
              Commentary {time(commentaryDuration)}
            </button>
          )}
        </span>
      ) : null}
    </div>
  );
}
