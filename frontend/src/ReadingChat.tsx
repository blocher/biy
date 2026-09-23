import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import {
  LockKeyhole,
  MessageCircle,
  Plus,
  X,
  ChevronRight,
} from "lucide-react";
import { ChatContent } from "./StudyChat";
import { ChatHistoryPanel } from "./ChatHistoryPanel";
import type { useStudyChat } from "./useStudyChat";
import { Design } from "./Design";
import source from "./design/reading-chat.html?raw";
import { useMobileDialogViewport } from "./useMobileDialogViewport";

type Chat = ReturnType<typeof useStudyChat>;

export function ReadingChatDialog({
  chat,
  open,
  onClose,
  readings,
}: {
  chat: Chat;
  open: boolean;
  onClose: () => void;
  readings: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [showHistory, setShowHistory] = useState(false);
  useMobileDialogViewport(dialog, open);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!open || !node) return;
    const before = document.body.style.overflow;
    node.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      node.close();
      document.body.style.overflow = before;
    };
  }, [open]);
  return createPortal(
    <dialog
      ref={dialog}
      className="reading-chat-dialog"
      aria-label="Ask"
      onCancel={() => {
        setShowHistory(false);
        onClose();
      }}
      onClose={() => {
        setShowHistory(false);
        onClose();
      }}
      onClick={(event) => {
        const link = (event.target as HTMLElement).closest('a[href^="/"]');
        if (link) onClose();
      }}
    >
      {open && (
        <Design
          source={source}
          className="reading-chat-surface"
          bindings={{
            "reading-chats": null,
            "reading-companion-header": (
              <>
                <div>
                  <h2>Ask</h2>
                  <p>{readings}</p>
                </div>
                <span>
                  <LockKeyhole size={14} /> Private to you
                </span>
                <button
                  aria-label="Close Ask"
                  onClick={() => {
                    setShowHistory(false);
                    onClose();
                  }}
                >
                  <X size={22} />
                </button>
              </>
            ),
            "reading-companion-divider": null,
            "reading-companion-question": null,
            "reading-companion-answer": showHistory ? (
              <ChatHistoryPanel
                chat={chat}
                onBack={() => setShowHistory(false)}
                onSelect={(id) => {
                  if (id === null) chat.newConversation();
                  else chat.select(String(id));
                  setShowHistory(false);
                }}
              />
            ) : (
              <ChatContent
                chat={chat}
                embedded
                onHistory={() => setShowHistory(true)}
              />
            ),
            "reading-companion-divider-2": null,
            "reading-companion-composer": null,
            "reading-companion-disclaimer": null,
          }}
        />
      )}
    </dialog>,
    document.body,
  );
}

export function ReadingChatHistory({
  chat,
  onOpen,
}: {
  chat: Chat;
  onOpen: () => void;
}) {
  return (
    <Design
      source={source}
      className="reading-chat-history"
      bindings={{
        "reading-companion": null,
        "reading-chats-header": (
          <>
            <h2>Your conversations</h2>
            <p className="reading-chat-subtitle">
              {chat.day ? `Day ${chat.day}` : "This episode"} · Private to you
            </p>
          </>
        ),
        "reading-chats-new": (
          <button
            className="reading-chat-new"
            disabled={chat.sending}
            onClick={() => {
              chat.newConversation();
              onOpen();
            }}
          >
            <Plus size={16} /> New conversation
          </button>
        ),
        "reading-chats-list": chat.saved.length ? (
          <ul>
            {chat.saved.slice(0, 3).map((c) => (
              <li key={c.id}>
                <button
                  disabled={chat.sending}
                  onClick={() => {
                    chat.select(String(c.id));
                    onOpen();
                  }}
                >
                  <MessageCircle size={16} />
                  <span>{c.title}</span>
                  <ChevronRight size={16} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="reading-chat-empty">
            Questions you ask about this reading will be saved here.
          </p>
        ),
        "reading-chats-privacy": (
          <Link className="text-link" to="/chat?history=1">
            View all conversations <ChevronRight size={14} />
          </Link>
        ),
      }}
    />
  );
}
