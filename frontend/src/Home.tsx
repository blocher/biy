import { usePreferences, BasisSelect } from "./Preferences";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  NotebookPen,
  CheckCircle2,
  CalendarDays,
  Clock3,
  TrendingUp,
} from "lucide-react";
import { Design } from "./Design";
import source from "./design/home.html?raw";
import type { Library } from "./types";
import { Sidebar } from "./navigation";
import { DayTable, Timeline } from "./Library";
import { date, episodeTitle } from "./api";
import { progressStats } from "./progress";

function percent(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

export function Home({
  user,
  library,
  onChange,
  onError,
}: {
  user: string;
  library: Library;
  onChange: () => void;
  onError: (e: string) => void;
}) {
  const preferenceState = usePreferences(onError);
  const next = library.days.find((d) => d.number === library.next_day),
    stats = progressStats(
      library,
      preferenceState.preferences?.progress_basis || "first-completion",
      new Date(),
      preferenceState.preferences?.leaderboard_start_date,
    );
  const schedule =
    stats.scheduleDelta === null
      ? {
          label: "Complete Day 1 to begin",
          tone: "starting",
          icon: CalendarDays,
        }
      : stats.scheduleDelta === 0
        ? { label: "On schedule", tone: "on-schedule", icon: CheckCircle2 }
        : {
            label: `${Math.abs(stats.scheduleDelta)} day${Math.abs(stats.scheduleDelta) === 1 ? "" : "s"} ${stats.scheduleDelta > 0 ? "ahead of" : "behind"} schedule`,
            tone: stats.scheduleDelta > 0 ? "ahead" : "behind",
            icon: stats.scheduleDelta > 0 ? TrendingUp : Clock3,
          };
  const ScheduleIcon = schedule.icon;
  return (
    <Design
      source={source}
      className="home-design"
      bindings={{
        "mobile-390-page-flow": null,
        sidebar: <Sidebar user={user} embedded />,
        header: (
          <>
            <span className="eyebrow">YOUR DAILY COMPANION</span>
            <span className="greeting">
              Welcome back, {user}{" "}
              <span className="avatar">{user[0].toUpperCase()}</span>
            </span>
          </>
        ),
        "hero-eyebrow": null,
        "hero-headline": (
          <h1>
            A little each day.
            <br />
            <em>A story that changes everything.</em>
          </h1>
        ),
        "hero-day-label": (
          <span className="eyebrow" style={{ color: next?.color || "#123f34" }}>
            {next
              ? `${next.era} · DAY ${next.number}`
              : "365 DAYS · ONE BEAUTIFUL JOURNEY"}
          </span>
        ),
        "hero-title": (
          <h2>
            {next
              ? next.episode
                ? episodeTitle(next.episode.title)
                : next.readings[0]
              : "You’ve read the whole story."}
          </h2>
        ),
        "hero-reference": (
          <p>
            {next?.readings.join(" · ") ||
              "Your notes and every reading are here whenever you want to return."}
          </p>
        ),
        "hero-continue": next ? (
          <>
            <Link
              className="primary continue-button"
              to={`/day/${next.number}`}
            >
              Continue Day {next.number}
              <ArrowRight size={21} />
            </Link>
            <span className="quiet">Your next unread day</span>
          </>
        ) : (
          <Link className="primary" to="/">
            <CheckCircle2 size={20} /> Revisit your year
          </Link>
        ),
        "hero-progress": (
          <div className="progress-panel">
            <div className="progress-summary">
              <strong
                className={`schedule-status schedule-status--${schedule.tone}`}
              >
                <ScheduleIcon size={17} aria-hidden="true" />
                {schedule.label}
              </strong>
              <span>
                {stats.lastCompleted
                  ? `Last completed: Day ${stats.lastCompleted.number} · ${date(stats.lastCompleted.completed_at)}`
                  : "No days completed yet"}
              </span>
            </div>
            <progress
              value={stats.completed}
              max={365}
              aria-label="Year completion"
            />
            <div className="progress-percentages">
              <span>{percent(stats.completedPercent)} completed</span>
              <span>{percent(stats.remainingPercent)} remaining</span>
            </div>
            <BasisSelect {...preferenceState} />
          </div>
        ),
        "hero-quote": null,
        "reading-rhythm": (
          <DayTable library={library} onChange={onChange} onError={onError} />
        ),
        reflection: (
          <>
            <span className="eyebrow">PAUSE & REFLECT</span>
            <h2>
              What is staying <br />
              with you today?
            </h2>
            <p>
              A thought, a question, a moment of grace. <br />
              Make a little space to notice.
            </p>
            <Link className="text-link" to="/journal">
              <NotebookPen size={18} /> Open your journal{" "}
              <ArrowRight size={16} />
            </Link>
          </>
        ),
        listen: null,
        eras: <Timeline library={library} />,
      }}
    />
  );
}
