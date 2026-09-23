import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { useEdition } from "./Edition";

export type ChatSource = {
  id: string;
  kind: string;
  title: string;
  text: string;
  url: string;
  metadata: {
    audio_time?: number;
    is_research_summary?: boolean;
    author?: string;
    year_label?: string;
    category?: string;
    condemned_by_council?: boolean;
  };
};
export type ChatTurn = {
  id: number;
  question: string;
  answer: string;
  follow_ups: string[];
  links: { label: string; path: string }[];
  progress_sources: {
    id: string;
    kind: string;
    title: string;
    url: string;
    day?: number;
  }[];
  status: string;
  sources: ChatSource[];
  notices: string[];
  stage: string;
  error: string;
  external_query: string;
  web_enabled: boolean;
};
type Conversation = {
  id: number;
  day: number | null;
  catechism_day: number | null;
  edition: "bible" | "catechism";
  episode: number | null;
  turns: ChatTurn[];
};
export type SavedConversation = Omit<Conversation, "turns"> & {
  title: string;
  last_activity: string;
};
type ConversationPage = { items: SavedConversation[]; has_more: boolean };
type ChatStatus = {
  configured: boolean;
  magisterium_configured: boolean;
  worker_online: boolean;
  public_chunks: number;
  public_pending: number;
  public_failed: number;
};

export function useStudyChat(scope?: {
  day: number | null;
  episode: number | null;
}) {
  const { edition } = useEdition();
  const [params, setParams] = useSearchParams();
  const [localId, setLocalId] = useState<string | null>(null);
  const id = scope ? localId : params.get("conversation");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function select(id: string | null) {
    if (scope) setLocalId(id);
    else
      setParams(
        id
          ? { conversation: id }
          : day
            ? { day: String(day) }
            : episode
              ? { episode: String(episode) }
              : {},
      );
  }
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [saved, setSaved] = useState<SavedConversation[]>([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const savedRequest = useRef(0);
  const nextPage = useRef(2);
  const [status, setStatus] = useState<ChatStatus | null>(null);
  const [question, setQuestion] = useState("");
  const [external, setExternal] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const pendingRequest = useRef<{ signature: string; id: string } | null>(null);
  const current = conversation?.id === Number(id) ? conversation : null;
  const day = current
    ? current.day || current.catechism_day
    : scope
      ? scope.day
      : Number(params.get("day")) || null;
  const episode = current
    ? current.episode
    : scope
      ? scope.episode
      : Number(params.get("episode")) || null;
  const busy =
    sending ||
    (!!id && !current) ||
    !!current?.turns.some((t) => ["queued", "running"].includes(t.status));
  const savedScope = scope?.day
    ? `?day=${scope.day}`
    : scope?.episode
      ? `?episode=${scope.episode}`
      : "?all_editions=true";
  const refreshSaved = useCallback(() => {
    const request = ++savedRequest.current;
    setHistoryLoading(true);
    setHistoryError("");
    const separator = savedScope ? "&" : "?";
    void api<ConversationPage>(
      `/chat/conversations${savedScope}${separator}page=1`,
    )
      .then((data) => {
        if (alive.current && request === savedRequest.current) {
          setSaved(data.items);
          setHasOlder(data.has_more);
          nextPage.current = 2;
        }
      })
      .catch((e) => {
        if (alive.current && request === savedRequest.current)
          setHistoryError(e.message);
      })
      .finally(() => {
        if (alive.current && request === savedRequest.current)
          setHistoryLoading(false);
      });
  }, [savedScope, edition]);
  useEffect(refreshSaved, [refreshSaved, id]);
  async function loadOlder() {
    if (!hasOlder || olderLoading || historyLoading) return;
    const request = savedRequest.current;
    const page = nextPage.current;
    const separator = savedScope ? "&" : "?";
    setOlderLoading(true);
    setHistoryError("");
    try {
      const data = await api<ConversationPage>(
        `/chat/conversations${savedScope}${separator}page=${page}`,
      );
      if (!alive.current || request !== savedRequest.current) return;
      setSaved((current) => [
        ...current,
        ...data.items.filter(
          (item) => !current.some((existing) => existing.id === item.id),
        ),
      ]);
      setHasOlder(data.has_more);
      nextPage.current = page + 1;
    } catch (e) {
      if (alive.current && request === savedRequest.current)
        setHistoryError((e as Error).message);
    } finally {
      if (alive.current && request === savedRequest.current)
        setOlderLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void api<ChatStatus>("/chat/status")
        .then((data) => {
          if (active) setStatus(data);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setConversation(null);
    setError("");
    pendingRequest.current = null;
    if (!id) return;
    setQuestion("");
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    let initial = true;
    const refresh = async () => {
      try {
        const data = await api<Conversation>(`/chat/conversations/${id}`);
        if (!active) return;
        setConversation(data);
        if (initial) {
          setExternal(data.turns.at(-1)?.web_enabled ?? true);
          initial = false;
        }
        timer = setTimeout(
          refresh,
          data.turns.some((t) => ["queued", "running"].includes(t.status))
            ? 750
            : 15000,
        );
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    };
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [id]);
  async function send(suggestion?: string) {
    const nextQuestion = suggestion ?? question;
    if (!nextQuestion.trim() || busy) return;
    if (suggestion) setQuestion(suggestion);
    const body = {
      question: nextQuestion.trim(),
      conversation_id: current?.id ?? null,
      day: current ? null : day,
      episode: current ? null : episode,
      edition,
      web_enabled: external,
    };
    const signature = JSON.stringify(body);
    if (pendingRequest.current?.signature !== signature)
      pendingRequest.current = { signature, id: crypto.randomUUID() };
    setSending(true);
    setError("");
    try {
      const result = await api<{ conversation_id: number }>(
        "/chat/ask",
        "POST",
        {
          ...body,
          request_id: pendingRequest.current.id,
        },
      );
      if (!alive.current) return;
      setQuestion("");
      pendingRequest.current = null;
      select(String(result.conversation_id));
      const data = await api<Conversation>(
        `/chat/conversations/${result.conversation_id}`,
      );
      if (!alive.current) return;
      setConversation(data);
      refreshSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  function newConversation() {
    select(null);
    setConversation(null);
    setQuestion("");
    setError("");
    pendingRequest.current = null;
  }
  async function removeConversation(conversationId: number) {
    if (
      (current?.id === conversationId && busy) ||
      !confirm("Delete this private conversation?")
    )
      return;
    try {
      await api(`/chat/conversations/${conversationId}`, "DELETE");
      if (current?.id === conversationId) newConversation();
      refreshSaved();
    } catch (e) {
      setHistoryError((e as Error).message);
      setError((e as Error).message);
    }
  }
  async function remove() {
    if (current) await removeConversation(current.id);
  }
  return {
    current,
    saved,
    hasOlder,
    historyLoading,
    olderLoading,
    historyError,
    status,
    question,
    setQuestion,
    external,
    setExternal,
    busy,
    sending,
    error,
    day,
    episode,
    edition,
    send,
    newConversation,
    remove,
    removeConversation,
    loadOlder,
    select,
  };
}
