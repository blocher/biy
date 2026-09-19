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
  outline?: { title: string; segment_id: number; start: number }[];
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
export type DayDetail = PlanDay & { scripture: Scripture[] };
export type Library = {
  days: PlanDay[];
  extras: Episode[];
  completed: number;
  next_day: number | null;
};
export type Note = {
  id: number;
  body: string;
  kind: "note" | "journal";
  audio_time: number | null;
  created_at: string;
  updated_at: string;
  day: number | null;
  episode: number | null;
};
