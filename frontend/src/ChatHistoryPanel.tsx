import { ArrowLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { date } from "./api";
import type { useStudyChat } from "./useStudyChat";

type Chat = ReturnType<typeof useStudyChat>;

export function ChatHistoryPanel({
  chat,
  onBack,
  onSelect,
}: {
  chat: Chat;
  onBack: () => void;
  onSelect: (id: number | null) => void;
}) {
  return (
    <section className="chat-history-panel" aria-label="Ask history">
      <header className="chat-history-heading">
        <button className="chat-history-back" onClick={onBack}>
          <ArrowLeft size={17} /> Back to Ask
        </button>
        <h2>Your conversations</h2>
        <p>Private to you · Most recent first</p>
      </header>
      <div className="chat-history-scroll">
        <button
          className="chat-history-new"
          disabled={chat.sending}
          onClick={() => onSelect(null)}
        >
          <Plus size={18} /> New conversation
        </button>
        {chat.historyError && (
          <p className="chat-notice" role="alert">
            {chat.historyError}
          </p>
        )}
        {chat.historyLoading && !chat.saved.length ? (
          <p role="status" className="chat-history-status">
            Loading conversations…
          </p>
        ) : chat.saved.length ? (
          <ul className="chat-history-list">
            {chat.saved.map((conversation) => {
              const context = conversation.day || conversation.catechism_day;
              return (
                <li key={conversation.id}>
                  <button
                    className="chat-history-open"
                    disabled={chat.sending}
                    onClick={() => onSelect(conversation.id)}
                  >
                    <span className="chat-history-title">
                      {conversation.title}
                    </span>
                    <span className="chat-history-meta">
                      {conversation.edition === "catechism"
                        ? "Catechism"
                        : "Bible"}
                      {context
                        ? ` · Day ${context}`
                        : conversation.episode
                          ? " · Extra episode"
                          : " · General"}
                      {` · ${date(conversation.last_activity)}`}
                    </span>
                    <ChevronRight size={17} aria-hidden="true" />
                  </button>
                  <button
                    className="chat-history-delete"
                    aria-label={`Delete conversation: ${conversation.title}`}
                    title="Delete conversation"
                    disabled={
                      chat.sending ||
                      (chat.current?.id === conversation.id && chat.busy)
                    }
                    onClick={() =>
                      void chat.removeConversation(conversation.id)
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="chat-history-empty">
            No conversations yet. Start with a question about your reading.
          </p>
        )}
        {chat.hasOlder && (
          <button
            className="chat-history-more"
            disabled={chat.olderLoading || chat.historyLoading}
            onClick={() => void chat.loadOlder()}
          >
            {chat.olderLoading ? "Loading…" : "Load older conversations"}
          </button>
        )}
      </div>
    </section>
  );
}
