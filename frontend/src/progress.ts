import type { Library, PlanDay } from "./types";

export type ProgressBasis = "first-completion" | "january-1" | "leaderboard";

const PLAN_DAYS = 365;

function calendarDay(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

export function progressStats(
  library: Library,
  basis: ProgressBasis,
  today = new Date(),
  leaderboardStart?: string,
) {
  const completedDays = library.days.filter(
    (day): day is PlanDay & { completed_at: string } => !!day.completed_at,
  );
  const byCompletion = [...completedDays].sort(
    (a, b) => Date.parse(a.completed_at) - Date.parse(b.completed_at),
  );
  const firstCompleted = byCompletion[0] || null;
  const lastCompleted = byCompletion.at(-1) || null;
  const completed = completedDays.length;

  return {
    completed,
    remaining: PLAN_DAYS - completed,
    completedPercent: Math.round((completed / PLAN_DAYS) * 1000) / 10,
    remainingPercent:
      Math.round(((PLAN_DAYS - completed) / PLAN_DAYS) * 1000) / 10,
    scheduleDelta: scheduleDelta(
      completed,
      firstCompleted?.completed_at || null,
      basis,
      leaderboardStart || "",
      today,
    ),
    firstCompleted,
    lastCompleted,
  };
}

export function scheduleDelta(
  completed: number,
  firstCompleted: string | null,
  basis: ProgressBasis,
  leaderboardStart: string,
  today = new Date(),
) {
  const start =
    basis === "first-completion"
      ? firstCompleted
      : basis === "leaderboard"
        ? leaderboardStart
        : `${today.getFullYear()}-01-01`;
  if (!start) return null;
  const startDate = new Date(start.length === 10 ? `${start}T00:00:00` : start);
  const expected = Math.max(
    0,
    Math.min(
      365,
      Math.floor((calendarDay(today) - calendarDay(startDate)) / 86_400_000) +
        1,
    ),
  );
  return completed - expected;
}
