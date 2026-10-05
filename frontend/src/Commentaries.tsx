import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  ExternalLink,
  Info,
  LibraryBig,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { api } from "./api";
import type { CommentaryResponse, Library } from "./types";
import { Sidebar } from "./navigation";
import { useStudyChat } from "./useStudyChat";
import { ReadingChatDialog } from "./ReadingChat";
import { ReadingCapture } from "./ReadingCapture";
import { offlineCommentaries } from "./offlineCommentaries";

function commentaryQuery(
  day: number,
  fromYear: string,
  toYear: string,
  category: string,
  page: number,
  focus: number | null,
) {
  const params = new URLSearchParams({ day: String(day), page: String(page) });
  if (fromYear) params.set("from_year", fromYear);
  if (toYear) params.set("to_year", toYear);
  if (category) params.set("category", category);
  if (focus) params.set("focus", String(focus));
  return `/commentaries?${params.toString()}`;
}

function parseYear(value: string) {
  return /^-?\d{1,4}$/.test(value) ? value : "";
}

export function Commentaries({
  user,
  library,
  onError,
}: {
  user: string;
  library: Library;
  onError: (message: string) => void;
}) {
  const [search, setSearch] = useSearchParams();
  const location = useLocation();
  const focusedCommentary = useMemo(() => {
    const match = location.hash.match(/^#commentary-(\d+)$/);
    return match ? Number(match[1]) : null;
  }, [location.hash]);
  const fallbackDay = library.next_day || 1;
  const dayNumber = Math.min(
    365,
    Math.max(1, Number(search.get("day")) || fallbackDay),
  );
  const chat = useStudyChat({ day: dayNumber, episode: null });
  const [chatOpen, setChatOpen] = useState(false);
  const [fromYear, setFromYear] = useState(search.get("from_year") || "");
  const [toYear, setToYear] = useState(search.get("to_year") || "");
  const [category, setCategory] = useState(search.get("category") || "");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CommentaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const selectedDay = library.days.find((day) => day.number === dayNumber);
  const query = useMemo(
    () =>
      commentaryQuery(
        dayNumber,
        fromYear,
        toYear,
        category,
        page,
        focusedCommentary,
      ),
    [dayNumber, fromYear, toYear, category, page, focusedCommentary],
  );

  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadError("");
    if (page === 1) setData(null);
    const accept = (result: CommentaryResponse) => {
      if (!live) return;
      setData((current) =>
        page === 1 || !current
          ? result
          : {
              ...result,
              commentaries: [...current.commentaries, ...result.commentaries],
            },
      );
    };
    api<CommentaryResponse>(query)
      .then(accept)
      .catch(async (error) => {
        if (!live) return;
        try {
          const saved = await offlineCommentaries(
            user,
            new URLSearchParams(query.split("?")[1]),
          );
          if (saved) {
            accept(saved);
            return;
          }
        } catch {
          // Keep the existing connection message if a local archive is damaged.
        }
        if (live) {
          const message = !navigator.onLine
            ? "Historical commentaries need a connection. Your saved reading plan is still available offline."
            : (error as Error).message;
          setLoadError(message);
          onError(message);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [query, onError]);

  useEffect(() => {
    if (!data || focusedCommentary === null) return;
    const frame = requestAnimationFrame(() => {
      document
        .getElementById(`commentary-${focusedCommentary}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [data, focusedCommentary]);

  useEffect(() => {
    setPage(1);
  }, [dayNumber, fromYear, toYear, category]);

  useEffect(() => {
    chat.select(null);
    setChatOpen(false);
  }, [dayNumber]);

  function updateDay(value: string) {
    const next = new URLSearchParams(search);
    next.set("day", value);
    setSearch(next, { replace: true });
  }

  function resetFilters() {
    setFromYear("");
    setToYear("");
    setCategory("");
    const next = new URLSearchParams(search);
    next.delete("from_year");
    next.delete("to_year");
    next.delete("category");
    setSearch(next, { replace: true });
  }

  function loadMore() {
    if (!data) return;
    setPage(data.page + 1);
  }

  const visibleRows = data?.commentaries || [];
  return (
    <div className="app-frame commentary-page">
      <Sidebar user={user} />
      <ReadingChatDialog
        chat={chat}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        readings={`Day ${dayNumber} · Historical commentary`}
      />
      <main className="commentary-main">
        <header className="commentary-header">
          <Link className="back-link" to="/">
            <ArrowLeft size={15} /> Reading plan
          </Link>
          <div className="commentary-heading-row">
            <div>
              <span className="eyebrow">THE CHURCH BESIDE YOU</span>
              <h1>Across the centuries</h1>
              <p>
                Historical voices matched to your daily reading, from the early
                Church to the present day.
              </p>
            </div>
            <LibraryBig className="commentary-heading-icon" size={42} />
          </div>
        </header>

        <section
          className="commentary-reading-picker"
          aria-labelledby="reading-heading"
        >
          <div>
            <span className="eyebrow">DAILY READING</span>
            <h2 id="reading-heading">
              Day {dayNumber} <span>·</span>{" "}
              {selectedDay?.era || "Reading plan"}
            </h2>
            <p>{selectedDay?.readings.join(" · ")}</p>
          </div>
          <label>
            <span className="sr-only">Choose a day</span>
            <select
              value={dayNumber}
              onChange={(event) => updateDay(event.target.value)}
            >
              {library.days.map((day) => (
                <option value={day.number} key={day.number}>
                  Day {day.number} · {day.readings.join(" · ")}
                </option>
              ))}
            </select>
          </label>
        </section>

        <section
          className="commentary-browser"
          aria-labelledby="browser-heading"
        >
          <div className="commentary-browser-heading">
            <div>
              <span className="eyebrow">{data?.edition || "RSV-2CE"}</span>
              <h2 id="browser-heading">Wisdom for today’s passage.</h2>
            </div>
            <span className="commentary-count">
              {data
                ? `${data.total.toLocaleString()} commentaries`
                : loadError
                  ? "Commentaries unavailable"
                  : "Loading commentaries…"}
            </span>
          </div>

          <form
            className="commentary-filters"
            onSubmit={(event) => {
              event.preventDefault();
              setFromYear(parseYear(fromYear));
              setToYear(parseYear(toYear));
              setPage(1);
            }}
          >
            <label>
              <span>From year</span>
              <input
                inputMode="numeric"
                placeholder={
                  data?.filters.min_year
                    ? String(data.filters.min_year)
                    : "e.g. 300"
                }
                value={fromYear}
                onChange={(event) => setFromYear(event.target.value)}
              />
            </label>
            <label>
              <span>To year</span>
              <input
                inputMode="numeric"
                placeholder={
                  data?.filters.max_year
                    ? String(data.filters.max_year)
                    : "e.g. 1900"
                }
                value={toYear}
                onChange={(event) => setToYear(event.target.value)}
              />
            </label>
            <label className="commentary-category-filter">
              <span>Tradition</span>
              <select
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="">All traditions</option>
                {data?.filters.categories.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <button className="commentary-filter-submit" type="submit">
              Filter <ArrowRight size={15} />
            </button>
            {(fromYear || toYear || category) && (
              <button
                className="commentary-reset"
                type="button"
                onClick={resetFilters}
              >
                <RotateCcw size={14} /> Reset
              </button>
            )}
          </form>

          <p className="commentary-sort-note">
            <Info size={15} /> Sorted oldest to newest. Sources without a known
            date remain at the end.
          </p>

          <ReadingCapture
            target={`/days/${dayNumber}`}
            contextLabel={`Day ${dayNumber} · Historical commentary`}
            chat={chat}
            onOpenAsk={() => setChatOpen(true)}
            onError={onError}
          >
            {loadError && !data ? (
              <div className="commentary-empty" role="alert">
                <BookOpen size={28} />
                <h3>Historical commentaries unavailable</h3>
                <p>{loadError}</p>
              </div>
            ) : loading && !data ? (
              <p className="commentary-loading" role="status">
                Gathering the witnesses…
              </p>
            ) : visibleRows.length ? (
              <div className="commentary-list">
                {visibleRows.map((entry, index) => (
                  <article
                    id={`commentary-${entry.database_id}`}
                    className={`commentary-card ${index === 0 ? "featured" : ""}`}
                    key={entry.id}
                    data-reading-citation={`${entry.author} · ${entry.source_title}`}
                    data-reading-url={`#commentary-${entry.database_id}`}
                  >
                    <div className="commentary-card-topline">
                      <span className="commentary-year">
                        {entry.year_label}
                      </span>
                      <span className="commentary-tradition">
                        {entry.author_metadata.category}
                      </span>
                    </div>
                    <div className="commentary-card-body">
                      <div className="commentary-card-heading">
                        <h3>{entry.author}</h3>
                        {entry.author_metadata.condemned_by_council && (
                          <span
                            className="commentary-condemned"
                            title="This author was condemned as a heretic by an ecumenical council."
                          >
                            <TriangleAlert size={14} /> Condemned at a council
                          </span>
                        )}
                      </div>
                      <p className="commentary-source">{entry.source_title}</p>
                      <p className="commentary-text">{entry.text}</p>
                      <div className="commentary-card-footer">
                        <span>{entry.matched_readings.join(" · ")}</span>
                        {entry.source_url && (
                          <a
                            href={entry.source_url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Source <ExternalLink size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="commentary-empty">
                <BookOpen size={28} />
                <h3>No commentaries match these filters.</h3>
                <p>Try widening the year range or choosing all traditions.</p>
              </div>
            )}
          </ReadingCapture>

          {data?.has_more && (
            <button
              className="commentary-load-more"
              onClick={loadMore}
              disabled={loading}
            >
              {loading ? "Loading…" : "Show more commentaries"}{" "}
              <ArrowRight size={16} />
            </button>
          )}

          {data?.matching_notes.length && (
            <details className="commentary-notes">
              <summary>
                About RSV-2CE matching and deuterocanonical books
              </summary>
              <ul>
                {data.matching_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          )}
        </section>
      </main>
    </div>
  );
}
