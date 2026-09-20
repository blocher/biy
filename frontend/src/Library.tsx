import { useMemo, useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  Check,
  Search,
  List,
  LayoutGrid,
  Headphones,
  NotebookPen,
  Pencil,
} from "lucide-react";
import type { Library, Note } from "./types";
import { api, date, dateInputValue, episodeTitle, shortDate } from "./api";
import { Sidebar } from "./navigation";
import { planEntries, type PlanEntry } from "./planEntries";
import {
  pageContainingIndex,
  readingPlanPage,
  readingPlanPageSize,
  READING_PLAN_PAGE_SIZES,
  READING_PLAN_PAGE_SIZE_STORAGE_KEY,
} from "./readingPlanPagination";
export function DayTable({
  library,
  onChange,
  onError,
}: {
  library: Library;
  onChange: () => void;
  onError: (e: string) => void;
}) {
  const [params, setParams] = useSearchParams();
  const query = params.get("q") || "";
  const era = params.get("era") || "";
  const status = ["all", "unread", "complete"].includes(
    params.get("status") || "",
  )
    ? (params.get("status") as "all" | "unread" | "complete")
    : "all";
  const view = params.get("view") === "grid" ? "grid" : "list";
  const page = readingPlanPage(params.get("page"));
  const count = readingPlanPageSize(
    params.get("items"),
    localStorage.getItem(READING_PLAN_PAGE_SIZE_STORAGE_KEY),
  );
  const [saving, setSaving] = useState<string | null>(null),
    [editingCompletionDate, setEditingCompletionDate] = useState<string | null>(
      null,
    );
  const entries = useMemo<PlanEntry[]>(
    () => planEntries(library).filter((entry) => entry.kind === "day"),
    [library],
  );
  const eras = useMemo(
    () =>
      Array.from(
        new Map([
          ...library.days.map((d) => [d.era, d.color] as const),
          ...library.extras
            .filter((e) => e.era)
            .map((e) => [e.era as string, e.color] as const),
        ]),
      ),
    [library],
  );
  const filtered = entries.filter((entry) => {
    const completed =
      entry.kind === "day"
        ? !!entry.day.completed_at
        : !!entry.episode.completed_at;
    const entryEra = entry.kind === "day" ? entry.day.era : entry.episode.era;
    const searchable =
      entry.kind === "day"
        ? `${entry.day.number} day ${entry.day.number} ${entry.day.readings.join(" ")} ${entry.day.episode?.title || ""}`
        : `supplement supplementary extra ${entry.episode.title} ${entry.episode.description || ""}`;
    return (
      (!era || entryEra === era) &&
      (status === "all" || (status === "complete" ? completed : !completed)) &&
      (!query || searchable.toLowerCase().includes(query.toLowerCase()))
    );
  });
  const pages = Math.max(1, Math.ceil(filtered.length / count)),
    safePage = Math.min(page, pages),
    shown = filtered.slice((safePage - 1) * count, safePage * count);
  const pageOptions = useMemo(
    () =>
      Array.from({ length: pages }, (_, index) => {
        const entriesOnPage = filtered.slice(
          index * count,
          (index + 1) * count,
        );
        const days = entriesOnPage
          .filter(
            (entry): entry is Extract<PlanEntry, { kind: "day" }> =>
              entry.kind === "day",
          )
          .map((entry) => entry.day.number);
        const start = index * count + 1;
        const end = Math.min((index + 1) * count, filtered.length);
        return {
          page: index + 1,
          label: days.length
            ? `${days.length > 1 ? "Days" : "Day"} ${days[0]}${days.length > 1 ? `–${days[days.length - 1]}` : ""}`
            : `Entries ${start}–${end}`,
        };
      }),
    [count, filtered, pages],
  );
  function changeParams(
    updates: Record<string, string | number | null>,
    replace = false,
  ) {
    const nextParams = new URLSearchParams(params);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === "") nextParams.delete(name);
      else nextParams.set(name, String(value));
    }
    setParams(nextParams, { replace });
  }
  function paramsHref(updates: Record<string, string | number | null>) {
    const nextParams = new URLSearchParams(params);
    for (const [name, value] of Object.entries(updates)) {
      if (value === null || value === "") nextParams.delete(name);
      else nextParams.set(name, String(value));
    }
    return `/?${nextParams.toString()}`;
  }
  useEffect(() => {
    const hasPage = params.has("page");
    const hasItems = params.has("items");
    if (hasPage && hasItems && page === safePage) return;

    let desiredPage = safePage;
    if (!hasPage) {
      const hasFilters = !!query || !!era || status !== "all";
      const nextUnreadIndex = hasFilters
        ? -1
        : entries.findIndex(
            (entry) =>
              entry.kind === "day" && entry.day.number === library.next_day,
          );
      desiredPage = pageContainingIndex(nextUnreadIndex, count);
    }
    const nextParams = new URLSearchParams(params);
    nextParams.set("page", String(Math.min(desiredPage, pages)));
    nextParams.set("items", String(count));
    setParams(nextParams, { replace: true });
  }, [
    count,
    entries,
    era,
    library.next_day,
    page,
    pages,
    params,
    query,
    safePage,
    setParams,
    status,
  ]);
  async function toggle(entry: PlanEntry) {
    setSaving(entry.key);
    try {
      if (entry.kind === "day") {
        await api(`/days/${entry.day.number}/completion`, "PUT", {
          completed: !entry.day.completed_at,
        });
      } else {
        await api(`/episodes/${entry.episode.id}/completion`, "PUT", {
          completed: !entry.episode.completed_at,
        });
      }
      onChange();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(null);
    }
  }
  function checkbox(entry: PlanEntry) {
    const completed =
      entry.kind === "day"
        ? entry.day.completed_at
        : entry.episode.completed_at;
    const label =
      entry.kind === "day"
        ? `Day ${entry.day.number}`
        : episodeTitle(entry.episode.title);
    return (
      <button
        className={"day-check " + (completed ? "checked" : "")}
        aria-label={`${completed ? "Mark incomplete" : "Mark complete"}: ${label}`}
        title={completed ? `Completed ${date(completed)}` : "Mark complete"}
        disabled={saving === entry.key}
        onClick={() => toggle(entry)}
      >
        {completed ? <Check size={15} /> : <span />}
      </button>
    );
  }
  async function updateCompletionDate(entry: PlanEntry, completed_on: string) {
    try {
      const path =
        entry.kind === "day"
          ? `/days/${entry.day.number}/completed-at`
          : `/episodes/${entry.episode.id}/completed-at`;
      await api(path, "PUT", { completed_on });
      setEditingCompletionDate(null);
      onChange();
    } catch (e) {
      onError((e as Error).message);
    }
  }
  function completionDate(entry: PlanEntry, completed: string) {
    return editingCompletionDate === entry.key ? (
      <input
        autoFocus
        aria-label="Completion date"
        className="completion-date-input"
        type="date"
        defaultValue={dateInputValue(completed)}
        onBlur={() => setEditingCompletionDate(null)}
        onChange={(event) => updateCompletionDate(entry, event.target.value)}
      />
    ) : (
      <span className="completion-date">
        Completed {shortDate(completed)}
        <button
          className="edit-completion-date"
          aria-label="Change completion date"
          title="Change completion date"
          onClick={() => setEditingCompletionDate(entry.key)}
        >
          <Pencil size={12} />
        </button>
      </span>
    );
  }
  return (
    <section className="plan-section" id="reading-plan">
      <div className="section-heading">
        <h2>Your reading plan</h2>
        <span className="quiet">{library.days.length} days</span>
      </div>
      <div className="filters">
        <label className="search">
          <Search size={17} />
          <input
            aria-label="Search days, episodes, or readings"
            placeholder="Find a day, episode, or reading…"
            value={query}
            onChange={(e) => changeParams({ q: e.target.value, page: 1 }, true)}
          />
        </label>
        <select
          aria-label="Filter by period"
          value={era}
          onChange={(e) => changeParams({ era: e.target.value, page: 1 })}
        >
          <option value="">All periods</option>
          {eras.map(([name]) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <select
          aria-label="Filter by completion"
          value={status}
          onChange={(e) => changeParams({ status: e.target.value, page: 1 })}
        >
          <option value="all">All entries</option>
          <option value="unread">Not completed</option>
          <option value="complete">Completed</option>
        </select>
        <div className="view-switch">
          <button
            aria-label="Table view"
            aria-pressed={view === "list"}
            onClick={() => changeParams({ view: "list" })}
          >
            <List size={18} />
          </button>
          <button
            aria-label="Card view"
            aria-pressed={view === "grid"}
            onClick={() => changeParams({ view: "grid" })}
          >
            <LayoutGrid size={18} />
          </button>
        </div>
      </div>
      {!shown.length ? (
        <div className="empty-content">
          <Search />
          <h3>No matching entries</h3>
          <p>Try another book, episode, day number, or filter.</p>
          <button
            onClick={() => {
              changeParams({ q: null, era: null, status: "all", page: 1 });
            }}
          >
            Clear filters
          </button>
        </div>
      ) : view === "list" ? (
        <div className="table-scroll">
          <table className="day-table">
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Complete</span>
                </th>
                <th>Day / type</th>
                <th>Episode &amp; readings</th>
                <th>Period</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Open</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((entry) => {
                if (entry.kind === "extra") {
                  const episode = entry.episode;
                  return (
                    <tr key={entry.key} className="supplementary-row">
                      <td>{checkbox(entry)}</td>
                      <td>
                        <Link
                          className="supplementary-kind"
                          to={`/episode/${episode.id}`}
                        >
                          <Headphones size={16} />
                          <span>Supplement</span>
                        </Link>
                      </td>
                      <td>
                        <Link to={`/episode/${episode.id}`}>
                          <strong>{episodeTitle(episode.title)}</strong>
                          <small>
                            Published {shortDate(episode.published_at)}
                            {" · "}
                            {Math.ceil(episode.duration / 60)} min
                            <span className="progress-exclusion">
                              Not counted in 365 days
                            </span>
                          </small>
                        </Link>
                        {episode.completed_at &&
                          completionDate(entry, episode.completed_at)}
                      </td>
                      <td>
                        <span className="era-label">
                          <i style={{ background: episode.color }} />
                          {episode.era || "Supplementary"}
                        </span>
                      </td>
                      <td>
                        <span
                          className={
                            episode.completed_at ? "status-complete" : "quiet"
                          }
                        >
                          {episode.completed_at ? "Completed" : "Optional"}
                        </span>
                      </td>
                      <td>
                        <Link
                          aria-label={`Open ${episodeTitle(episode.title)}`}
                          to={`/episode/${episode.id}`}
                        >
                          <ArrowRight size={17} />
                        </Link>
                      </td>
                    </tr>
                  );
                }

                const day = entry.day;
                return (
                  <tr
                    key={entry.key}
                    className={
                      day.number === library.next_day ? "next-day" : ""
                    }
                  >
                    <td>{checkbox(entry)}</td>
                    <td>
                      <Link to={`/day/${day.number}`}>Day {day.number}</Link>
                    </td>
                    <td>
                      <Link to={`/day/${day.number}`}>
                        <strong>
                          {day.episode
                            ? episodeTitle(day.episode.title)
                            : day.readings[0]}
                        </strong>
                        <small>
                          {day.readings.join(" · ")}
                          {day.episode && (
                            <>
                              <br />
                              Published {shortDate(day.episode.published_at)}
                            </>
                          )}
                        </small>
                      </Link>
                      {day.completed_at &&
                        completionDate(entry, day.completed_at)}
                    </td>
                    <td>
                      <span className="era-label">
                        <i style={{ background: day.color }} />
                        {day.era}
                      </span>
                    </td>
                    <td>
                      <span
                        className={
                          day.completed_at ? "status-complete" : "quiet"
                        }
                      >
                        {day.completed_at
                          ? "Completed"
                          : day.number === library.next_day
                            ? "Up next"
                            : "Unread"}
                      </span>
                    </td>
                    <td>
                      <Link
                        aria-label={`Open Day ${day.number}`}
                        to={`/day/${day.number}`}
                      >
                        <ArrowRight size={17} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="day-grid">
          {shown.map((entry) => {
            if (entry.kind === "extra") {
              const episode = entry.episode;
              return (
                <article
                  key={entry.key}
                  className="day-card supplementary-card"
                  style={{ borderTopColor: episode.color }}
                >
                  <div className="section-heading">
                    <span className="eyebrow supplementary-kind">
                      <Headphones size={15} /> Supplement
                    </span>
                    {checkbox(entry)}
                  </div>
                  <Link to={`/episode/${episode.id}`}>
                    <h3>{episodeTitle(episode.title)}</h3>
                    <p>
                      {date(episode.published_at)} ·{" "}
                      {Math.ceil(episode.duration / 60)} min
                    </p>
                    <span className="progress-exclusion">
                      Not counted in 365 days
                    </span>
                  </Link>
                </article>
              );
            }

            const day = entry.day;
            return (
              <article
                key={entry.key}
                className="day-card"
                style={{ borderTopColor: day.color }}
              >
                <div className="section-heading">
                  <span className="eyebrow">DAY {day.number}</span>
                  {checkbox(entry)}
                </div>
                <Link to={`/day/${day.number}`}>
                  <h3>
                    {day.episode
                      ? episodeTitle(day.episode.title)
                      : day.readings[0]}
                  </h3>
                  <p>{day.readings.join(" · ")}</p>
                  <span className="era-label">
                    <i style={{ background: day.color }} />
                    {day.era}
                  </span>
                </Link>
              </article>
            );
          })}
        </div>
      )}
      <div className="pagination">
        <span>
          {filtered.length
            ? `${(safePage - 1) * count + 1}–${Math.min(safePage * count, filtered.length)} of ${filtered.length}`
            : "0 entries"}
        </span>
        <label className="page-select">
          <span>Jump to</span>
          <select
            aria-label="Jump to day range"
            value={safePage}
            onChange={(e) => changeParams({ page: Number(e.target.value) })}
          >
            {pageOptions.map(({ page: optionPage, label }) => (
              <option key={optionPage} value={optionPage}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="page-select">
          <span>Rows</span>
          <select
            aria-label="Rows per page"
            value={count}
            onChange={(e) => {
              const nextCount = Number(e.target.value);
              const firstVisibleIndex = (safePage - 1) * count;
              localStorage.setItem(
                READING_PLAN_PAGE_SIZE_STORAGE_KEY,
                String(nextCount),
              );
              changeParams({
                items: nextCount,
                page: pageContainingIndex(firstVisibleIndex, nextCount),
              });
            }}
          >
            {READING_PLAN_PAGE_SIZES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {safePage > 1 ? (
          <Link
            className="pagination-button"
            to={paramsHref({ page: safePage - 1 })}
          >
            Previous
          </Link>
        ) : (
          <span className="pagination-button disabled" aria-disabled="true">
            Previous
          </span>
        )}
        <span>{pageOptions[safePage - 1]?.label}</span>
        {safePage < pages ? (
          <Link
            className="pagination-button"
            to={paramsHref({ page: safePage + 1 })}
          >
            Next
          </Link>
        ) : (
          <span className="pagination-button disabled" aria-disabled="true">
            Next
          </span>
        )}
      </div>
    </section>
  );
}
export function Timeline({ library }: { library: Library }) {
  const eras = Array.from(
    new Map(
      library.days.map((d) => [d.era, { color: d.color, day: d.number }]),
    ).entries(),
  );
  return (
    <div className="timeline">
      <div className="section-heading">
        <h2>One story, a journey through Scripture</h2>
      </div>
      <div className="timeline-colors">
        {eras.map(([name, e]) => (
          <Link
            title={name}
            key={name}
            to={`/?era=${encodeURIComponent(name)}`}
            style={{ background: e.color }}
          />
        ))}
      </div>
      <div className="timeline-labels">
        {eras.map(([name, e]) => (
          <span key={name}>
            <i style={{ background: e.color }} />
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
export function LibraryPage({
  library,
  user,
}: {
  library: Library;
  user: string;
}) {
  const [query, setQuery] = useState("");
  return (
    <div className="app-frame">
      <Sidebar user={user} />
      <main className="simple-page">
        <span className="eyebrow">YOUR DAILY COMPANION</span>
        <h1>A little more context.</h1>
        <p className="page-intro">
          Introductions, conversations, and bonus episodes from 2025.
        </p>
        <label className="search">
          <Search size={17} />
          <input
            placeholder="Search extra episodes…"
            aria-label="Search extra episodes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        {library.extras.length ? (
          <div className="extras-grid">
            {library.extras
              .filter((e) =>
                e.title.toLowerCase().includes(query.toLowerCase()),
              )
              .map((e) => (
                <Link className="extra-card" to={`/episode/${e.id}`} key={e.id}>
                  <div className="section-heading">
                    <Headphones style={{ color: e.color }} />
                    {e.completed_at && <Check size={18} />}
                  </div>
                  <h2>{episodeTitle(e.title)}</h2>
                  <p>
                    {date(e.published_at)} · {Math.ceil(e.duration / 60)} min
                  </p>
                  <span className="text-link">
                    Open study <ArrowRight size={16} />
                  </span>
                </Link>
              ))}
          </div>
        ) : (
          <div className="empty-content">
            <Headphones size={32} />
            <h2>Room for the whole conversation.</h2>
            <p>
              Introductions and bonus episodes will appear here when imported.
              Each gets transcripts, commentary, audio links, and a private
              journal.
            </p>
            <p className="quiet">
              The current test imports Day 1 only. Extra episodes don’t count
              toward your 365 days.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
export function Journal({
  user,
  onError,
}: {
  user: string;
  onError: (e: string) => void;
}) {
  const [notes, setNotes] = useState<Note[] | null>(null),
    [query, setQuery] = useState("");
  const [community, setCommunity] = useState(false);
  const [person, setPerson] = useState("");
  useEffect(() => {
    let live = true;
    setNotes(null);
    api<Note[]>(community ? "/shared-notes" : "/notes")
      .then((data) => {
        if (live) setNotes(data);
      })
      .catch((e) => onError(e.message));
    return () => {
      live = false;
    };
  }, [community]);
  const filteredNotes = notes?.filter(
    (n) =>
      (!person || String(n.author.id) === person) &&
      n.body.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="app-frame">
      <Sidebar user={user} />
      <main className="simple-page">
        <span className="eyebrow">REFLECTIONS ALONG THE WAY</span>
        <h1>What stays with you.</h1>
        <p className="page-intro">
          Your notes, questions, and prayers, gathered along the way.
        </p>
        <div className="segmented">
          <button
            aria-pressed={!community}
            className={!community ? "active" : ""}
            onClick={() => {
              setCommunity(false);
              setPerson("");
            }}
          >
            My entries
          </button>
          <button
            aria-pressed={community}
            className={community ? "active" : ""}
            onClick={() => {
              setCommunity(true);
              setPerson("");
            }}
          >
            Community entries
          </button>
        </div>
        {community && (
          <label className="person-filter">
            Person{" "}
            <select
              aria-label="Person"
              value={person}
              onChange={(e) => setPerson(e.target.value)}
            >
              <option value="">Everyone</option>
              {Array.from(
                new Map((notes || []).map((n) => [n.author.id, n.author.name])),
              ).map(([id, name]) => (
                <option value={id} key={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="search">
          <Search size={17} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search reflections…"
            aria-label="Search reflections"
          />
        </label>
        {notes === null ? (
          <p role="status">Loading reflections…</p>
        ) : filteredNotes?.length ? (
          <div className="journal-grid">
            {filteredNotes.map((n) => (
              <article className="journal-card" key={n.id}>
                <span className="eyebrow">
                  {community ? `${n.author.name} · ` : ""}
                  {n.kind} · {date(n.created_at)}
                  {n.shared ? " · Shared" : ""}
                </span>
                <p>{n.body}</p>
                <Link
                  className="text-link"
                  to={n.day ? `/day/${n.day}` : `/episode/${n.episode}`}
                >
                  Return to {n.day ? `Day ${n.day}` : "episode"}{" "}
                  <ArrowRight size={15} />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-content">
            <NotebookPen size={32} />
            <h2>
              {notes.length
                ? "No matching reflections."
                : community
                  ? "No community entries yet."
                  : "A space to make it your own."}
            </h2>
            <p>
              Open a day and save a note or journal entry. Your reflections will
              collect here. Mark an entry Shared to share it with the community.
            </p>
            <Link className="primary" to="/day/1">
              Begin with Day 1 <ArrowRight size={16} />
            </Link>
          </div>
        )}
      </main>
    </div>
  );
}
