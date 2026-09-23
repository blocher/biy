import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  LockKeyhole,
  Plus,
  Send,
  Trash2,
} from "lucide-react";
import { Sidebar } from "./navigation";
import { Design } from "./Design";
import { time } from "./api";
import { useStudyChat, type ChatTurn } from "./useStudyChat";
import source from "./design/chat.html?raw";
import "./studyChat.css";

export function Answer({ turn }: { turn: ChatTurn }) {
  function openSource(id: string) {
    const node = document.getElementById(
      `citation-${turn.id}-${id}`,
    ) as HTMLDetailsElement | null;
    if (node) {
      const list = node.closest(".chat-sources") as HTMLDetailsElement | null;
      if (list) list.open = true;
      node.open = true;
      node.scrollIntoView({ behavior: "smooth", block: "nearest" });
      node.focus();
    }
  }
  return (
    <>
      <div className="chat-answer-text">
        {turn.answer
          .split(
            /(\[[DSMWH]\d+\]|\/(?:(?:day\/[1-9]\d{0,2}|episode\/[1-9]\d*)(?:\/reader)?|commentaries|journal|chat|leaderboard|account)(?:\?[A-Za-z0-9_=&%.-]+)?(?:#[A-Za-z0-9_-]+)?)/g,
          )
          .map((part, index) => {
            if (part.startsWith("/"))
              return (
                <a className="chat-inline-link" key={index} href={part}>
                  {part}
                </a>
              );
            const id = part.slice(1, -1);
            const citation = turn.sources.find((s) => s.id === id);
            return citation ? (
              <button
                className="chat-citation"
                key={index}
                onClick={() => openSource(id)}
                aria-label={`Read source: ${citation.title}`}
              >
                [{turn.sources.indexOf(citation) + 1}]
              </button>
            ) : (
              part
            );
          })}
      </div>
      {!!turn.links?.length && (
        <nav className="chat-answer-links" aria-label="Related pages">
          {turn.links.map((link) => (
            <a key={link.path} href={link.path}>
              {link.label}
              <ArrowUpRight size={15} />
            </a>
          ))}
        </nav>
      )}
      {!!turn.sources.length && (
        <details className="chat-sources" aria-label="Answer sources">
          <summary>View {turn.sources.length} cited sources</summary>
          {turn.sources.map((s, index) => (
            <details
              key={s.id}
              id={`citation-${turn.id}-${s.id}`}
              tabIndex={-1}
            >
              <summary>
                <span className="chat-source-id">[{index + 1}]</span>
                <span>
                  <small>
                    {(
                      {
                        scripture: "Scripture · RSV-2CE",
                        catechism: "Catechism · Vatican source",
                        reading_day: "Reading plan day",
                        commentary: "Fr. Mike commentary",
                        journal: "Member reflection",
                        historical_commentary: "Historical witness",
                        magisterium: "Via Magisterium",
                        web: "Open web",
                      } as Record<string, string>
                    )[s.kind] || s.kind}
                  </small>
                  {s.title}
                  {s.metadata.audio_time != null
                    ? ` · ${time(s.metadata.audio_time)}`
                    : ""}
                  {s.kind === "historical_commentary" && (
                    <small>
                      {s.metadata.year_label}
                      {s.metadata.category ? ` · ${s.metadata.category}` : ""}
                      {s.metadata.condemned_by_council
                        ? " · Condemned by a council"
                        : ""}
                    </small>
                  )}
                </span>
              </summary>
              <p className="chat-excerpt">{s.text}</p>
              {s.metadata.is_research_summary && (
                <small>
                  Web research summary; follow the original source to verify.
                </small>
              )}
              {s.url &&
                (s.url.startsWith("/") ? (
                  <a className="text-link" href={s.url}>
                    Open in study{" "}
                    {s.metadata.audio_time != null
                      ? `· ${time(s.metadata.audio_time)}`
                      : ""}{" "}
                    <ArrowUpRight size={14} />
                  </a>
                ) : (
                  <a
                    className="text-link"
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Read original source <ArrowUpRight size={14} />
                  </a>
                ))}
            </details>
          ))}
        </details>
      )}
      {turn.notices.map((n) => (
        <p className="chat-notice" key={n}>
          {n}
        </p>
      ))}
      {turn.external_query && (
        <details className="chat-research-topic">
          <summary>Outside research topic</summary>
          <p>{turn.external_query}</p>
        </details>
      )}
    </>
  );
}

export function StudyChat({ user }: { user: string }) {
  const chat = useStudyChat();
  return (
    <div className="app-frame study-chat-frame">
      <Sidebar user={user} />
      <main className="study-chat-page">
        <ChatContent chat={chat} />
      </main>
    </div>
  );
}

export function ChatContent({
  chat,
  embedded = false,
}: {
  chat: ReturnType<typeof useStudyChat>;
  embedded?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const newestTurn = useRef<HTMLElement>(null);
  const previousLast = useRef<{ id: number; answerLength: number } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const turns = chat.current?.turns ?? [];
  const last = turns.at(-1);
  useEffect(() => {
    const previous = previousLast.current;
    if (
      last?.answer &&
      previous?.id === last.id &&
      previous.answerLength === 0
    ) {
      newestTurn.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (last && previous?.id !== last.id && last.status !== "complete") {
      end.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    previousLast.current = last
      ? { id: last.id, answerLength: last.answer.length }
      : null;
  }, [last?.id, last?.status, last?.answer]);
  const context = chat.day
    ? `Day ${chat.day}`
    : chat.episode
      ? "Extra episode"
      : "Your whole study";
  const returnTo = chat.day
    ? `/day/${chat.day}`
    : chat.episode
      ? `/episode/${chat.episode}`
      : "/";
  const examples =
    chat.edition === "catechism"
      ? [
          "How does today’s teaching connect to Scripture?",
          "Explain this Catechism passage in plain language.",
          "What did Fr. Mike emphasize today?",
          "Has anyone shared a reflection about this teaching?",
        ]
      : [
          "What was the previous reading about?",
          "How did this person enter the story?",
          "What did Fr. Mike say about sacrifices?",
          "Has anyone shared a reflection about the Eucharist?",
        ];
  return (
    <>
      {!embedded && (
        <div className="chat-page-heading">
          <Link className="back-link" to={returnTo}>
            <ArrowLeft size={16} />
            Back to {chat.day || chat.episode ? "reading" : "reading plan"}
          </Link>
          <span className="eyebrow">READ · ASK · UNDERSTAND</span>
        </div>
      )}
      <div className="chat-controls">
        <label>
          <span className="sr-only">Saved conversations</span>
          <select
            aria-label="Saved conversations"
            disabled={chat.sending}
            value={chat.current?.id ?? ""}
            onChange={(e) => e.target.value && chat.select(e.target.value)}
          >
            <option value="">A new conversation</option>
            {chat.saved.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => chat.newConversation()} disabled={chat.sending}>
          <Plus size={16} />
          New conversation
        </button>
        {chat.current && (
          <button
            aria-label="Delete conversation"
            disabled={chat.busy}
            onClick={() => void chat.remove()}
          >
            <Trash2 size={17} />
          </button>
        )}
      </div>
      <Design
        source={source}
        className="study-chat"
        bindings={{
          "companion-header": embedded ? null : (
            <>
              <div className="chat-title-row">
                <h1>Ask</h1>
                <span>
                  <LockKeyhole size={14} />
                  Private to you
                </span>
              </div>
              <p>Make sense of the story. Follow the sources.</p>
            </>
          ),
          "companion-divider": null,
          "companion-meta": (
            <>
              <span className="chat-context">
                <BookOpen size={16} />
                {context} · Searches Bible and Catechism
              </span>
              <label className="chat-external">
                <input
                  type="checkbox"
                  checked={chat.external}
                  onChange={(e) => chat.setExternal(e.target.checked)}
                />
                Include outside sources
              </label>
            </>
          ),
          "companion-question": null,
          "companion-answer": (
            <>
              {!chat.status && (
                <p role="status">Checking study availability…</p>
              )}
              {chat.status && !chat.status.configured && (
                <p className="chat-notice">
                  Ask needs an OpenAI API key configured on the server.
                </p>
              )}
              {chat.status && !chat.status.worker_online && (
                <p className="chat-notice" role="status">
                  The study worker is offline. Questions will be available when
                  it restarts.
                </p>
              )}
              {chat.status &&
                chat.external &&
                !chat.status.magisterium_configured && (
                  <p className="chat-notice">
                    Magisterium is not connected yet. Site sources and open-web
                    research are available.
                  </p>
                )}
              {!!chat.status?.public_pending && (
                <p className="chat-index-status">
                  Search is being prepared:{" "}
                  {chat.status.public_chunks - chat.status.public_pending} of{" "}
                  {chat.status.public_chunks} excerpts ready for semantic
                  search. Keyword search is available now.
                </p>
              )}
              {!!chat.status?.public_failed && (
                <p className="chat-notice">
                  Some source excerpts need indexing attention. Keyword search
                  remains available.
                </p>
              )}
              {!turns.length && !(embedded && chat.question.trim()) && (
                <div className="chat-empty">
                  <h2>What would you like to understand?</h2>
                  <p>
                    Start with Scripture, Fr. Mike’s commentary, or reflections
                    from your study group.
                  </p>
                  <div className="chat-examples">
                    {examples.map((q) => (
                      <button key={q} onClick={() => chat.setQuestion(q)}>
                        {q}
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="chat-turns" aria-label="Conversation">
                {turns.map((t, index) => (
                  <article
                    key={t.id}
                    ref={index === turns.length - 1 ? newestTurn : undefined}
                    className="chat-turn"
                  >
                    {t.question.includes("I highlighted:\n\n") ? (
                      <details className="chat-selected-question">
                        <summary>Question about a highlighted passage</summary>
                        <p className="chat-question">{t.question}</p>
                      </details>
                    ) : (
                      <h2 className="chat-question">{t.question}</h2>
                    )}
                    {t.status === "complete" ? (
                      <>
                        <Answer turn={t} />
                        {!!t.follow_ups?.length && (
                          <div
                            className="chat-follow-ups"
                            aria-label="Suggested follow-up questions"
                          >
                            <p>Keep exploring</p>
                            {t.follow_ups.map((q) => (
                              <button
                                key={q}
                                disabled={
                                  chat.busy ||
                                  !!chat.question.trim() ||
                                  !chat.status?.configured ||
                                  !chat.status?.worker_online
                                }
                                onClick={() => void chat.send(q)}
                              >
                                {q}
                                <ArrowUpRight size={15} />
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : t.status === "failed" ? (
                      <div className="chat-failure">
                        <p role="alert" className="chat-notice">{t.error}</p>
                        <button
                          disabled={chat.busy}
                          onClick={() => {
                            chat.setQuestion(t.question);
                            editor.current?.focus();
                          }}
                        >
                          Edit and try again
                        </button>
                      </div>
                    ) : (
                      <>
                        {!!t.answer && (
                          <div className="chat-streaming-answer">
                            <Answer turn={t} />
                          </div>
                        )}
                        <div className="chat-working">
                          <p role="status">
                            <span />
                            {t.stage}…
                          </p>
                          {!t.answer && !!t.progress_sources?.length && (
                            <div
                              className="chat-progress-sources"
                              aria-label="Sources found so far"
                            >
                              {t.progress_sources.map((source) =>
                                source.url.startsWith("/") ? (
                                  <a key={source.id} href={source.url}>
                                    {source.title}
                                    <ArrowUpRight size={13} />
                                  </a>
                                ) : (
                                  <span key={source.id}>{source.title}</span>
                                ),
                              )}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </article>
                ))}
              </div>
              <div ref={end} />
            </>
          ),
          "companion-sources": null,
          "companion-tabs": null,
          "companion-source-list": null,
          "companion-save": null,
          "companion-form": (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void chat.send();
              }}
            >
              {chat.error && (
                <p role="alert" className="chat-notice">
                  {chat.error}
                </p>
              )}
              <label htmlFor="study-question">Your question</label>
              <div className="chat-composer">
                <textarea
                  ref={editor}
                  id="study-question"
                  value={chat.question}
                  maxLength={4000}
                  onChange={(e) => chat.setQuestion(e.target.value)}
                  placeholder="Ask about this reading…"
                  rows={embedded ? 2 : 3}
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      !e.shiftKey &&
                      !e.nativeEvent.isComposing
                    ) {
                      e.preventDefault();
                      void chat.send();
                    }
                  }}
                />
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    chat.busy ||
                    !chat.question.trim() ||
                    !chat.status?.configured ||
                    !chat.status.worker_online
                  }
                >
                  {chat.busy ? "Working…" : "Send"}
                  <Send size={16} />
                </button>
              </div>
              <p className="chat-footnote">
                {chat.external
                  ? "Site sources first, then Magisterium and the open web when useful."
                  : "Answers use your site’s study materials."}{" "}
                Enter to send · Shift + Enter for a new line.
              </p>
              <details className="chat-privacy">
                <summary>How your study materials are used</summary>
                <p>
                  Relevant passages and accessible notes are sent to OpenAI to
                  compose answers. Notes are also sent to OpenAI to prepare
                  search. Outside research uses a general topic from your
                  question; retrieved journal text is not sent to Magisterium or
                  web search. Turn outside sources off for sensitive questions.
                </p>
              </details>
            </form>
          ),
        }}
      />
    </>
  );
}
