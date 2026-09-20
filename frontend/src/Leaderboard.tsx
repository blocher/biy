import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LockKeyhole, CalendarDays } from "lucide-react";
import { api, date } from "./api";
import { Sidebar } from "./navigation";
import { Design } from "./Design";
import { BasisSelect, usePreferences } from "./Preferences";
import { scheduleDelta } from "./progress";
import source from "./design/leaderboard.html?raw";
import "./design/leaderboard.css";
import "./leaderboard.css";
type Reader = {
  id: number;
  name: string;
  completed: number;
  current_day: number | null;
  first_completed: string | null;
};
export function Leaderboard({
  user,
  onError,
}: {
  user: string;
  onError: (message: string) => void;
}) {
  const prefs = usePreferences(onError);
  const [readers, setReaders] = useState<Reader[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    api<Reader[]>("/leaderboard")
      .then((data) => {
        if (live) setReaders(data);
      })
      .catch((e) => {
        if (live) {
          setFailed(true);
          onError(e.message);
        }
      });
    return () => {
      live = false;
    };
  }, [onError]);
  const settings = prefs.preferences;
  return (
    <Design
      source={source}
      className="leaderboard-design"
      bindings={{
        sidebar: <Sidebar user={user} embedded />,
        hero: (
          <>
            <div className="leaderboard-intro">
              <span className="eyebrow">YOUR READING COMMUNITY</span>
              <h1>Leaderboard</h1>
              <p>A little encouragement for your daily reading.</p>
            </div>
            <span className="private-group">
              <LockKeyhole size={15} /> Private group
            </span>
          </>
        ),
        filters: (
          <>
            <BasisSelect {...prefs} />
            <div className="leaderboard-date">
              <span>Leaderboard start date</span>
              <Link to="/account">
                <CalendarDays size={18} />
                {settings
                  ? date(settings.leaderboard_start_date + "T00:00:00")
                  : "Loading…"}
              </Link>
            </div>
            <p className="basis-explanation">
              {settings?.progress_basis === "first-completion"
                ? "Each person’s schedule begins on their first completed reading day."
                : settings?.progress_basis === "january-1"
                  ? "Everyone’s schedule begins on January 1 of this year."
                  : "Everyone’s schedule begins on the shared leaderboard start date."}{" "}
              Your selection is saved to your account.
            </p>
          </>
        ),
        leaderboard:
          readers === null || !settings ? (
            <p role="status">
              {failed
                ? "Could not load the leaderboard. Refresh to try again."
                : "Loading your reading community…"}
            </p>
          ) : readers.length ? (
            <div className="leaderboard-table-scroll">
              <table className="community-table">
                <caption className="sr-only">
                  Reading progress, ordered by completed days
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Person</th>
                    <th scope="col">Current day</th>
                    <th scope="col">Completed days</th>
                    <th scope="col">Schedule</th>
                  </tr>
                </thead>
                <tbody>
                  {readers.map((reader) => {
                    const delta = scheduleDelta(
                      reader.completed,
                      reader.first_completed,
                      settings.progress_basis,
                      settings.leaderboard_start_date,
                    );
                    return (
                      <tr key={reader.id}>
                        <th scope="row">
                          <span className="reader-avatar" aria-hidden="true">
                            {reader.name
                              .split(" ")
                              .map((p) => p[0])
                              .slice(0, 2)
                              .join("")}
                          </span>
                          <span>{reader.name}</span>
                        </th>
                        <td>
                          {reader.current_day
                            ? `Day ${reader.current_day}`
                            : "Finished"}
                        </td>
                        <td>{reader.completed} / 365</td>
                        <td
                          className={
                            delta === null || delta === 0
                              ? "quiet"
                              : delta > 0
                                ? "schedule-ahead"
                                : "schedule-behind"
                          }
                        >
                          {delta === null
                            ? "Not started"
                            : delta === 0
                              ? "On schedule"
                              : `${Math.abs(delta)} day${Math.abs(delta) === 1 ? "" : "s"} ${delta > 0 ? "ahead" : "behind"}`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p>No members are showing their progress yet.</p>
          ),
        footer: (
          <>
            <p>Everyone’s journey begins on a different day.</p>
            <Link to="/account">Manage your leaderboard visibility</Link>
          </>
        ),
      }}
    />
  );
}
