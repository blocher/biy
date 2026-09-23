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
type SavedConversation = Omit<Conversation, "turns"> & { title: string };
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
      : "";
  const refreshSaved = useCallback(() => {
    void api<SavedConversation[]>(`/chat/conversations${savedScope}`)
      .then((data) => {
        if (alive.current) setSaved(data);
      })
      .catch((e) => setError(e.message));
  }, [savedScope]);
  useEffect(refreshSaved, [refreshSaved, id]);
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
  async function remove() {
    if (!current || !confirm("Delete this private conversation?")) return;
    try {
      await api(`/chat/conversations/${current.id}`, "DELETE");
      newConversation();
      refreshSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return {
    current,
    saved,
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
    select,
  };
}
