import {
  createContext,
  useContext,
  useRef,
  useState,
  useEffect,
  type ReactNode,
} from "react";
import { Play, Pause, SkipBack, SkipForward, X, Volume2 } from "lucide-react";
import { api, time, episodeTitle } from "./api";
import type { Episode } from "./types";
export type AudioClip = { start: number; end: number };
type AudioState = {
  episode: Episode | null;
  position: number;
  playing: boolean;
  clipPlayback: boolean;
  loading: boolean;
  error: string;
  play: (e: Episode, at?: number) => void;
  playClips: (e: Episode, clips: AudioClip[]) => void;
  seek: (n: number) => void;
  toggle: () => void;
};
const AudioContext = createContext<AudioState>(null!);
export const useAudio = () => useContext(AudioContext);
export function AudioProvider({
  children,
  onError,
}: {
  children: ReactNode;
  onError: (e: string) => void;
}) {
  const [episode, setEpisode] = useState<Episode | null>(null),
    [position, setPosition] = useState(0),
    [playing, setPlaying] = useState(false),
    [clipPlayback, setClipPlayback] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [speed, setSpeed] = useState(1);
  const audio = useRef<HTMLAudioElement>(null),
    pending = useRef<number | null>(null),
    autoplay = useRef(false),
    lastSave = useRef(0),
    episodeRef = useRef<Episode | null>(null),
    clipQueue = useRef<AudioClip[]>([]),
    clipIndex = useRef(0),
    clipFinished = useRef(false);
  function save() {
    const e = episodeRef.current;
    if (e && audio.current)
      void api(`/episodes/${e.id}/position`, "PUT", {
        position: audio.current.currentTime,
      }).catch((err) => onError(err.message));
  }
  function playbackError(message: string) {
    setLoading(false);
    setPlaying(false);
    setError(message);
    onError(message);
  }
  function startPlayback() {
    setError("");
    setLoading(true);
    void audio.current?.play().catch((error) => {
      setLoading(false);
      if (error.name !== "AbortError")
        playbackError("Could not play audio. Please try again.");
    });
  }
  function begin(e: Episode, at?: number) {
    if (!e.has_audio && !e.audio) {
      onError("Audio has not been imported for this episode yet.");
      return;
    }
    setError("");
    setLoading(true);
    if (episodeRef.current?.id === e.id && audio.current) {
      if (audio.current.error || audio.current.readyState === 0) {
        pending.current = at ?? audio.current.currentTime;
        autoplay.current = true;
        audio.current.load();
      } else {
        if (at !== undefined) {
          audio.current.currentTime = at;
          setPosition(at);
        }
        startPlayback();
      }
      return;
    }
    if (episodeRef.current) save();
    pending.current = at ?? e.position ?? 0;
    autoplay.current = true;
    episodeRef.current = e;
    setEpisode(e);
    setPosition(pending.current);
    lastSave.current = 0;
  }
  function play(e: Episode, at?: number) {
    clipQueue.current = [];
    clipIndex.current = 0;
    clipFinished.current = false;
    setClipPlayback(false);
    begin(e, at);
  }
  function playClips(e: Episode, clips: AudioClip[]) {
    const valid = clips.filter(
      (clip) =>
        Number.isFinite(clip.start) &&
        Number.isFinite(clip.end) &&
        clip.start >= 0 &&
        clip.end > clip.start,
    );
    if (!valid.length) {
      onError("Audio is not available for this reading yet.");
      return;
    }
    clipQueue.current = valid;
    clipIndex.current = 0;
    clipFinished.current = false;
    setClipPlayback(true);
    begin(e, valid[0].start);
  }
  function seek(n: number) {
    if (audio.current) {
      const clip = clipQueue.current[clipIndex.current];
      const minimum = clip?.start ?? 0;
      const maximum =
        clip?.end ??
        (Number.isFinite(audio.current.duration)
          ? audio.current.duration
          : (episode?.duration ?? 0));
      clipFinished.current = false;
      audio.current.currentTime = Math.max(minimum, Math.min(n, maximum));
    }
  }
  function toggle() {
    if (!audio.current) return;
    if (playing) audio.current.pause();
    else {
      const clips = clipQueue.current;
      if (
        clips.length &&
        audio.current.currentTime >= clips[clips.length - 1].end - 0.05
      ) {
        clipIndex.current = 0;
        clipFinished.current = false;
        audio.current.currentTime = clips[0].start;
        setPosition(clips[0].start);
      }
      if (episodeRef.current)
        begin(episodeRef.current, audio.current.currentTime);
    }
  }
  useEffect(() => {
    const hide = () => save();
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, []);
  return (
    <AudioContext.Provider
      value={{
        episode,
        position,
        playing,
        clipPlayback,
        loading,
        error,
        play,
        playClips,
        seek,
        toggle,
      }}
    >
      {children}
      <audio
        ref={audio}
        src={episode ? `/api/episodes/${episode.id}/audio` : undefined}
        preload="metadata"
        onLoadedMetadata={() => {
          if (audio.current) {
            audio.current.currentTime = pending.current ?? 0;
            audio.current.playbackRate = speed;
            pending.current = null;
            if (autoplay.current) {
              autoplay.current = false;
              startPlayback();
            }
          }
        }}
        onTimeUpdate={() => {
          const value = audio.current?.currentTime || 0;
          setPosition(value);
          const clip = clipQueue.current[clipIndex.current];
          if (
            audio.current &&
            clip &&
            !clipFinished.current &&
            value >= clip.end - 0.05
          ) {
            const nextIndex = clipIndex.current + 1;
            const next = clipQueue.current[nextIndex];
            if (next) {
              clipIndex.current = nextIndex;
              audio.current.currentTime = next.start;
              setPosition(next.start);
            } else {
              clipFinished.current = true;
              audio.current.pause();
              audio.current.currentTime = clip.end;
              setPosition(clip.end);
            }
            return;
          }
          if (Date.now() - lastSave.current > 15000) {
            lastSave.current = Date.now();
            save();
          }
        }}
        onWaiting={() => setLoading(true)}
        onPlaying={() => {
          setLoading(false);
          setError("");
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => {
          setPlaying(false);
          setLoading(false);
          save();
        }}
        onEnded={() => {
          setPlaying(false);
          setLoading(false);
          save();
        }}
        onError={() =>
          episode &&
          playbackError(
            "Audio could not load. Check your connection and try again.",
          )
        }
      />
      {episode && (
        <section className="player" aria-label="Episode audio player">
          <div className="player-name">
            <span className="eyebrow">
              {episode.day ? `DAY ${episode.day}` : "SUPPLEMENTARY EPISODE"}
            </span>
            <strong>{episodeTitle(episode.title)}</strong>
          </div>
          <div className="player-buttons">
            <button
              aria-label="Back 15 seconds"
              onClick={() => seek(position - 15)}
            >
              <SkipBack size={18} />
              <small>15</small>
            </button>
            <button
              className="play-round"
              aria-label={playing ? "Pause" : "Play"}
              onClick={toggle}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <button
              aria-label="Forward 15 seconds"
              onClick={() => seek(position + 15)}
            >
              <SkipForward size={18} />
              <small>15</small>
            </button>
          </div>
          <div className="seek">
            <input
              aria-label="Audio position"
              type="range"
              min="0"
              max={episode.duration || 1}
              step="0.1"
              value={Math.min(position, episode.duration || 1)}
              onChange={(e) => seek(Number(e.target.value))}
            />
            <span>
              {time(position)} / {time(episode.duration)}
            </span>
          </div>
          <select
            aria-label="Playback speed"
            value={speed}
            onChange={(e) => {
              const rate = Number(e.target.value);
              setSpeed(rate);
              if (audio.current) audio.current.playbackRate = rate;
            }}
          >
            {[0.75, 1, 1.25, 1.5, 1.75, 2].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
          <label className="volume">
            <Volume2 size={17} />
            <input
              type="range"
              min="0"
              max="1"
              step=".05"
              defaultValue="1"
              aria-label="Volume"
              onChange={(e) => {
                if (audio.current)
                  audio.current.volume = Number(e.target.value);
              }}
            />
          </label>
          <button
            aria-label="Close player"
            onClick={() => {
              audio.current?.pause();
              save();
              episodeRef.current = null;
              clipQueue.current = [];
              clipIndex.current = 0;
              setClipPlayback(false);
              setLoading(false);
              setError("");
              setEpisode(null);
            }}
          >
            <X size={18} />
          </button>
        </section>
      )}
    </AudioContext.Provider>
  );
}
