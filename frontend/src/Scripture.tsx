import { Pause, Play } from "lucide-react";
import { time } from "./api";
import type { Scripture as Passage, ScriptureAudioCue } from "./types";

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
}: {
  passages: Passage[];
  audio?: ScriptureAudio;
  toolbar?: boolean;
}) {
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
                {[...new Set(group.verses.map((v) => v.chapter))].map((ch) => (
                  <div className="chapter" key={ch}>
                    <h3>
                      {group.book} <span>{ch}</span>
                    </h3>
                    <div>
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
                              <sup>{v.verse}</sup>
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
    </div>
  );
}
