import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Search, X } from "lucide-react";
import { api } from "./api";
import { useMobileDialogViewport } from "./useMobileDialogViewport";

type Result = {
  key: string;
  kind: string;
  title: string;
  excerpt: string;
  url: string;
};

const labels: Record<string, string> = {
  scripture: "Scripture",
  catechism: "Catechism",
  commentary: "Episode commentary",
  historical_commentary: "Historical commentary",
  journal: "Journal",
  reading_day: "Reading day",
};

export function SiteSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useMobileDialogViewport(dialog, open);

  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const before = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    input.current?.focus();
    return () => {
      node.close();
      document.body.style.overflow = before;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const phrase = query.trim();
    if (phrase.length < 2) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError("");
    const timer = window.setTimeout(() => {
      void api<{ results: Result[] }>(`/search?q=${encodeURIComponent(phrase)}`)
        .then((data) => { if (live) setResults(data.results); })
        .catch((failure: Error) => { if (live) setError(failure.message); })
        .finally(() => { if (live) setLoading(false); });
    }, 220);
    return () => { live = false; clearTimeout(timer); };
  }, [open, query]);

  return (
    <dialog ref={dialog} className="site-search-dialog" aria-labelledby="site-search-title" onCancel={onClose}>
      <div className="site-search-header">
        <div>
          <h2 id="site-search-title">Search the site</h2>
          <p>Find readings, commentary, and notes without an AI answer.</p>
        </div>
        <button type="button" aria-label="Close site search" onClick={onClose}><X size={20} /></button>
      </div>
      <label className="site-search-input">
        <Search size={20} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          aria-label="Search readings and commentary"
          placeholder="Search a word, phrase, or reference"
          value={query}
          maxLength={120}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div className="site-search-results" aria-live="polite">
        {query.trim().length < 2 ? (
          <p className="site-search-message">Type at least two characters to search.</p>
        ) : error ? (
          <p className="site-search-message" role="alert">{error}</p>
        ) : loading ? (
          <p className="site-search-message">Searching…</p>
        ) : results.length ? (
          <>
            <p className="site-search-count">Top {results.length} {results.length === 1 ? "result" : "results"}</p>
            <ul>
              {results.map((result) => (
                <li key={result.key}>
                  <Link to={result.url} onClick={(event) => {
                    if (!event.metaKey && !event.ctrlKey && !event.shiftKey && event.button === 0) onClose();
                  }}>
                    <span className="site-search-kind">{labels[result.kind] || "Reading"}</span>
                    <strong>{result.title}</strong>
                    <span>{result.excerpt}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="site-search-message">No results. Try a shorter term or another spelling.</p>
        )}
      </div>
    </dialog>
  );
}
