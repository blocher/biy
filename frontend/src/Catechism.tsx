import { useState } from "react";
import {
  CatechismBody,
  CatechismReferencePanel,
  ParagraphReferences,
  type ReferenceView,
} from "./CatechismReferences";
import { Pause, Play } from "lucide-react";
import { time } from "./api";
import { useAudio } from "./Audio";
import type { CatechismParagraph, Episode } from "./types";
import {
  audioSpanContaining,
  audioSpanDuration,
  mergeAudioSpans,
} from "./studyText";
import "./catechismAudio.css";

export function Catechism({
  paragraphs,
  episode,
  era,
  section,
  chapter,
  toolbar,
}: {
  paragraphs: CatechismParagraph[];
  episode: Episode | null;
  era: string;
  section?: string;
  chapter?: string;
  toolbar: boolean;
}) {
  const audio = useAudio();
  const [reference, setReference] = useState<ReferenceView | null>(null);
  const [showReferences, setShowReferences] = useState(false);
  const structured = paragraphs.some((p) => p.content?.schema === 1);
  const cues = paragraphs.flatMap((paragraph) =>
    paragraph.audio ? [paragraph.audio] : [],
  );
  const clips = mergeAudioSpans(cues);
  const available = Boolean(episode?.has_audio && clips.length);
  const episodeActive = audio.episode?.id === episode?.id;
  const active = episodeActive && audio.clipPlayback;
  const current = active && audioSpanContaining(clips, audio.position);
  const label = current
    ? audio.playing
      ? "Pause Catechism"
      : "Resume Catechism"
    : "Play Catechism";
  return (
    <article className="catechism-text">
      <header>
        <span className="eyebrow">{era}</span>
        {!structured && section && <p>{section}</p>}
        {!structured && chapter && <p>{chapter}</p>}
        {structured && (
          <>
            <p>
              {paragraphs[0]?.content?.context?.map((h) => h.text).join(" · ")}
            </p>
            <button
              className="ccc-reference-toggle"
              aria-pressed={showReferences}
              onClick={() => setShowReferences((v) => !v)}
            >
              {showReferences
                ? "Hide reference labels"
                : "Show reference labels"}
            </button>
          </>
        )}
      </header>
      {available && toolbar && (
        <div className="scripture-audio-bar">
          <button
            className="scripture-audio-primary"
            aria-label={label}
            onClick={() =>
              current ? audio.toggle() : audio.playClips(episode!, clips)
            }
          >
            <span className="scripture-audio-icon">
              {current && audio.playing ? (
                <Pause size={17} />
              ) : (
                <Play size={17} />
              )}
            </span>
            <span>
              <strong>{label}</strong>
              <small>
                {cues.length} of {paragraphs.length} paragraphs ·{" "}
                {time(audioSpanDuration(clips))}
              </small>
            </span>
          </button>
        </div>
      )}
      <p className="catechism-audio-status" role="status">
        {episodeActive && audio.error
          ? audio.error
          : episodeActive && audio.loading
            ? "Loading audio…"
            : !episode?.has_audio
              ? "Audio has not been imported for this day yet."
              : !cues.length
                ? "Paragraph audio is not available yet. Listen to the full episode from the study page."
                : cues.length < paragraphs.length
                  ? `Audio is available for ${cues.length} of ${paragraphs.length} paragraphs.`
                  : "Play the reading or listen to an individual paragraph."}
      </p>
      {paragraphs.map((paragraph) => {
        const cue = paragraph.audio;
        const paragraphActive = Boolean(
          active &&
          cue &&
          audio.position >= cue.start &&
          audio.position < cue.end,
        );
        const action = paragraphActive
          ? audio.playing
            ? "Pause"
            : "Resume"
          : "Play";
        return (
          <section
            className={`catechism-paragraph${paragraphActive ? " audio-active" : ""}`}
            key={paragraph.number}
            aria-label={`Catechism paragraph ${paragraph.number}`}
          >
            <CatechismBody paragraph={paragraph} open={setReference} before />
            {episode?.has_audio && cue && (
              <button
                className="passage-audio-button"
                aria-label={`${action} Catechism paragraph ${paragraph.number}`}
                onClick={() =>
                  paragraphActive
                    ? audio.toggle()
                    : audio.playClips(episode, [cue])
                }
              >
                {paragraphActive && audio.playing ? (
                  <Pause size={14} />
                ) : (
                  <Play size={14} />
                )}
                {action} paragraph
              </button>
            )}
            <div
              id={`ccc-${paragraph.number}`}
              data-reading-citation={`Catechism § ${paragraph.number}`}
              data-reading-url={`#ccc-${paragraph.number}`}
            >
              <CatechismBody paragraph={paragraph} open={setReference} />
            </div>
            <ParagraphReferences
              paragraph={paragraph}
              open={setReference}
              expanded={showReferences}
            />
          </section>
        );
      })}
      <a
        className="text-link"
        href={paragraphs[0]?.source_url}
        target="_blank"
        rel="noopener noreferrer"
      >
        Read the source on {paragraphs[0]?.provenance?.source || "vatican.va"}
      </a>
      {reference && (
        <CatechismReferencePanel
          initial={reference}
          close={() => setReference(null)}
        />
      )}
    </article>
  );
}
