import type { Episode, Segment } from "./types";

export type TranscriptParagraph = {
  segmentIds: number[];
  start: number;
  end: number;
  speaker: string;
  text: string;
  partial: boolean;
};

const TARGET_PARAGRAPH_WORDS = 70;
const MAX_PARAGRAPH_WORDS = 130;
const MEANINGFUL_PAUSE_SECONDS = 4;

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function endsThought(text: string) {
  return /[.!?][”"']?$/.test(text.trim());
}

export function groupTranscriptSegments(
  segments: Segment[] | undefined,
  supplementary: boolean,
): TranscriptParagraph[] {
  if (!segments?.length) return [];

  const paragraphs: TranscriptParagraph[] = [];
  for (const segment of segments) {
    const previous = paragraphs.at(-1);
    const differentSpeaker =
      supplementary && previous?.speaker !== segment.speaker;
    const meaningfulPause =
      previous && segment.start - previous.end >= MEANINGFUL_PAUSE_SECONDS;
    const requestedParagraph = previous && segment.paragraph_break_before;
    const currentWords = previous ? wordCount(previous.text) : 0;
    const combinedWords = currentWords + wordCount(segment.text);
    const sizeBoundary =
      previous &&
      (combinedWords > MAX_PARAGRAPH_WORDS ||
        (currentWords >= TARGET_PARAGRAPH_WORDS && endsThought(previous.text)));

    if (
      !previous ||
      requestedParagraph ||
      differentSpeaker ||
      meaningfulPause ||
      sizeBoundary
    ) {
      paragraphs.push({
        segmentIds: [segment.id],
        start: segment.start,
        end: segment.end,
        speaker: segment.speaker,
        text: segment.text.trim(),
        partial: !!segment.partial,
      });
      continue;
    }

    previous.segmentIds.push(segment.id);
    previous.end = segment.end;
    previous.text = `${previous.text} ${segment.text.trim()}`;
    previous.partial ||= !!segment.partial;
  }
  return paragraphs;
}

function canonicalSpeaker(name: string | null | undefined) {
  const normalized = name?.toLocaleLowerCase();
  if (normalized?.includes("mike")) return "Fr. Mike Schmitz";
  if (normalized?.includes("jeff")) return "Jeff Cavins";
  return null;
}

export function supplementarySpeakerNames(episode: Episode) {
  const segmentsById = new Map(
    episode.transcript?.map((segment) => [segment.id, segment]),
  );
  const candidates = new Map<string, Set<string>>();

  for (const item of episode.outline || []) {
    const name = canonicalSpeaker(item.speaker);
    const sourceSpeaker = segmentsById.get(item.segment_id)?.speaker;
    if (!name || !sourceSpeaker) continue;
    const names = candidates.get(sourceSpeaker) || new Set<string>();
    names.add(name);
    candidates.set(sourceSpeaker, names);
  }

  return new Map(
    [...candidates]
      .filter(([, names]) => names.size === 1)
      .map(([sourceSpeaker, names]) => [sourceSpeaker, [...names][0]]),
  );
}

export function plainOutlineTitle(title: string) {
  const trimmed = title.trim();
  const linkedTitle = trimmed.match(/^\[([^\]]+)\]\(#segment-\d+\)$/i);
  return linkedTitle?.[1] || trimmed;
}

export type AudioSpan = { start: number; end: number };

export function mergeAudioSpans(spans: AudioSpan[] | undefined): AudioSpan[] {
  const merged: AudioSpan[] = [];
  for (const span of [...(spans || [])].sort((a, b) => a.start - b.start)) {
    if (
      !Number.isFinite(span.start) ||
      !Number.isFinite(span.end) ||
      span.end <= span.start
    ) {
      continue;
    }
    const previous = merged.at(-1);
    if (previous && span.start <= previous.end + 0.35) {
      previous.end = Math.max(previous.end, span.end);
      continue;
    }
    merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

export function audioSpanDuration(spans: AudioSpan[]) {
  return spans.reduce((total, span) => total + (span.end - span.start), 0);
}

export function audioSpanContaining(spans: AudioSpan[], position: number) {
  return spans.find((span) => position >= span.start && position < span.end);
}
