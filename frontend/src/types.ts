export type Segment = {
  id: number;
  start: number;
  end: number;
  speaker: string;
  text: string;
  partial?: boolean;
};
export type Episode = {
  id: number;
  title: string;
  day: number | null;
  era: string | null;
  color: string;
  duration: number;
  status: string;
  has_audio: boolean;
  source_date: string;
  completed_at?: string | null;
  published_at: string;
  description?: string;
  audio?: string | null;
  position?: number;
  transcript?: Segment[];
  commentary?: Segment[];
  edited_commentary?: {
    heading: string;
    text: string;
    segment_ids: number[];
  }[];
  summary?: string;
  key_points?: { text: string }[];
  outline?: {
    heading: "Reading" | "Commentary";
    title: string;
    segment_id: number;
    start: number;
    speaker?: string | null;
  }[];
  processed_at?: string;
  provenance?: Record<string, unknown>;
};
export type PlanDay = {
  number: number;
  readings: string[];
  era: string;
  color: string;
  completed_at: string | null;
  episode: Episode | null;
};
export type Scripture = {
  reference: string;
  audio?: ScriptureAudioCue | null;
  groups: {
    book: string;
    missing: boolean;
    verses: {
      chapter: number;
      verse: number;
      text: string;
      paragraph: boolean;
    }[];
  }[];
};
export type ScriptureAudioCue = {
  passage_index: number;
  reference: string;
  start: number;
  end: number;
  confidence: number;
};
export type DayDetail = PlanDay & { scripture: Scripture[] };
export type CommentaryAuthor = {
  name: string;
  category: string;
  default_year: number;
  year_label: string;
  wiki_url: string;
  condemned_by_council: boolean;
};
export type CommentaryEntry = {
  id: string;
  author: string;
  author_metadata: CommentaryAuthor;
  year: number;
  year_label: string;
  source_title: string;
  source_url: string;
  text: string;
  book: string;
  location_start: number;
  location_end: number;
  matched_readings: string[];
};
export type CommentaryResponse = {
  day: number;
  readings: string[];
  edition: string;
  commentaries: CommentaryEntry[];
  total: number;
  page: number;
  page_size: number;
  has_more: boolean;
  filters: {
    categories: string[];
    min_year: number | null;
    max_year: number | null;
  };
  matching_notes: string[];
};
export type Library = {
  days: PlanDay[];
  extras: Episode[];
  completed: number;
  next_day: number | null;
};
export type Note = {
  shared: boolean;
  author: { id: number; name: string };
  id: number;
  body: string;
  kind: "note" | "journal";
  audio_time: number | null;
  created_at: string;
  updated_at: string;
  day: number | null;
  episode: number | null;
};
