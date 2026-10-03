import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, X } from "lucide-react";
import { api } from "./api";
import type {
  CatechismBlock,
  CatechismInline,
  CatechismNote,
} from "./catechismContent";
import type { CatechismParagraph, Scripture } from "./types";
import "./catechismReferences.css";

export type ReferenceView =
  | { type: "notes"; paragraph: CatechismParagraph }
  | { type: "note"; paragraph: CatechismParagraph; note: CatechismNote }
  | { type: "ccc"; number: number }
  | { type: "bible"; reference: string; label: string };
type OpenReference = (view: ReferenceView) => void;

type InlineProps = {
  nodes: CatechismInline[];
  paragraph: CatechismParagraph;
  open: OpenReference;
};
export function CatechismInlines({ nodes, paragraph, open }: InlineProps) {
  return (
    <>
      {nodes.map((node, i) => {
        const children = node.children ? (
          <CatechismInlines
            nodes={node.children}
            paragraph={paragraph}
            open={open}
          />
        ) : (
          node.text
        );
        if (node.type === "note") {
          const note = paragraph.content?.notes?.find((n) => n.id === node.id);
          return note ? (
            <sup key={i}>
              <button
                className="ccc-note-marker"
                aria-label={`Footnote ${note.label} for CCC ${paragraph.number}`}
                onClick={() => open({ type: "note", paragraph, note })}
              >
                {note.label}
              </button>
            </sup>
          ) : null;
        }
        if (node.type === "bible")
          return node.reference ? (
            <button
              key={i}
              className="ccc-inline-reference"
              onClick={() =>
                open({
                  type: "bible",
                  reference: node.reference!,
                  label: node.text || node.reference!,
                })
              }
            >
              {node.text}
            </button>
          ) : (
            <span key={i} title="See the original source for this reference">
              {node.text}
            </span>
          );
        if (node.type === "em") return <em key={i}>{children}</em>;
        if (node.type === "strong") return <strong key={i}>{children}</strong>;
        if (node.type === "item") return <li key={i}>{children}</li>;
        if (node.type === "row") return <tr key={i}>{children}</tr>;
        if (node.type === "cell") return <td key={i}>{children}</td>;
        return <span key={i}>{children}</span>;
      })}
    </>
  );
}

function ContentBlock({
  block,
  paragraph,
  open,
  number,
}: {
  block: CatechismBlock;
  paragraph: CatechismParagraph;
  open: OpenReference;
  number?: boolean;
}) {
  const text = (
    <>
      {number && <strong className="ccc-number">{paragraph.number} </strong>}
      <CatechismInlines
        nodes={block.children}
        paragraph={paragraph}
        open={open}
      />
    </>
  );
  if (block.kind === "heading")
    return (
      <h3 className="ccc-heading" data-heading-level={block.level}>
        {text}
      </h3>
    );
  if (block.kind === "quote") return <blockquote>{text}</blockquote>;
  if (block.kind === "list") return <ul>{text}</ul>;
  if (block.kind === "ordered_list") return <ol>{text}</ol>;
  if (block.kind === "table")
    return (
      <div className="ccc-table-scroll">
        <table>
          <tbody>{text}</tbody>
        </table>
      </div>
    );
  return <p>{text}</p>;
}

export function CatechismBody({
  paragraph,
  open,
  before = false,
}: {
  paragraph: CatechismParagraph;
  open: OpenReference;
  before?: boolean;
}) {
  if (before)
    return (
      <>
        {paragraph.content?.before?.map((block, i) => (
          <ContentBlock
            key={i}
            block={block}
            paragraph={paragraph}
            open={open}
          />
        ))}
      </>
    );
  if (!paragraph.content?.blocks?.length)
    return (
      <p>
        <strong className="ccc-number">{paragraph.number}</strong>{" "}
        {paragraph.text}
      </p>
    );
  return (
    <>
      {paragraph.content.blocks.map((block, i) => (
        <ContentBlock
          key={i}
          block={block}
          paragraph={paragraph}
          open={open}
          number={i === 0}
        />
      ))}
    </>
  );
}

export function ParagraphReferences({
  paragraph,
  open,
  expanded = false,
}: {
  paragraph: CatechismParagraph;
  open: OpenReference;
  expanded?: boolean;
}) {
  const notes = paragraph.content?.notes || [];
  const cross = paragraph.content?.cross_references || [];
  if (!notes.length && !cross.length) return null;
  return (
    <div className="ccc-paragraph-references" data-reading-ignore="true">
      <button
        className="ccc-reference-summary"
        onClick={() => open({ type: "notes", paragraph })}
      >
        References <span>{notes.length + cross.length}</span>
      </button>
      {expanded && (
        <div className="ccc-reference-labels">
          {notes.map((note) => (
            <button
              key={note.id}
              onClick={() => open({ type: "note", paragraph, note })}
            >
              Note {note.label}
            </button>
          ))}
          {cross.map((number) => (
            <button key={number} onClick={() => open({ type: "ccc", number })}>
              CCC {number}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

type CCCResult = { paragraph: CatechismParagraph; context_url: string | null };
type BibleResult = {
  passage: Scripture;
  translation: string;
  context_url: string | null;
};
export function CatechismReferencePanel({
  initial,
  close,
}: {
  initial: ReferenceView;
  close: () => void;
}) {
  const [stack, setStack] = useState([initial]);
  const view = stack[stack.length - 1];
  const [result, setResult] = useState<CCCResult | BibleResult | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const body = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const cache = useRef(new Map<string, CCCResult | BibleResult>());
  const open: OpenReference = (next) => setStack((old) => [...old, next]);
  useEffect(() => {
    const element = dialog.current!;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    element.showModal();
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      requestAnimationFrame(() => {
        if (!element.open && returnFocus.current?.isConnected)
          returnFocus.current.focus({ preventScroll: true });
      });
    };
  }, []);
  useEffect(() => {
    let active = true;
    setResult(null);
    setError("");
    body.current?.scrollTo(0, 0);
    title.current?.focus({ preventScroll: true });
    const path =
      view.type === "ccc"
        ? `/catechism/paragraphs/${view.number}`
        : view.type === "bible"
          ? `/catechism/bible-reference?reference=${encodeURIComponent(view.reference)}`
          : null;
    if (path) {
      const found = cache.current.get(path);
      if (found) setResult(found);
      else
        api<CCCResult | BibleResult>(path)
          .then((value) => {
            cache.current.set(path, value);
            if (active) setResult(value);
          })
          .catch((e) => {
            if (active) setError(e.message);
          });
    }
    return () => {
      active = false;
    };
  }, [view, retry]);
  const heading =
    view.type === "notes"
      ? `CCC ${view.paragraph.number} · References`
      : view.type === "note"
        ? `CCC ${view.paragraph.number} · Note ${view.note.label}`
        : view.type === "ccc"
          ? `Catechism ${view.number}`
          : view.label;
  let content: ReactNode;
  let source: string | undefined;
  if (view.type === "note") {
    source = view.paragraph.source_url;
    content = (
      <p className="ccc-note-text">
        <CatechismInlines
          nodes={view.note.children}
          paragraph={view.paragraph}
          open={open}
        />
      </p>
    );
  } else if (view.type === "notes") {
    source = view.paragraph.source_url;
    content = (
      <>
        {!!view.paragraph.content?.cross_references?.length && (
          <section>
            <h3>Related Catechism paragraphs</h3>
            <div className="ccc-reference-labels">
              {view.paragraph.content.cross_references.map((number) => (
                <button
                  key={number}
                  onClick={() => open({ type: "ccc", number })}
                >
                  CCC {number}
                </button>
              ))}
            </div>
          </section>
        )}
        {!!view.paragraph.content?.notes?.length && (
          <section>
            <h3>Footnotes</h3>
            <ol className="ccc-note-list">
              {view.paragraph.content.notes.map((note) => (
                <li key={note.id}>
                  <span className="ccc-note-label">{note.label}</span>
                  <div>
                    <CatechismInlines
                      nodes={note.children}
                      paragraph={view.paragraph}
                      open={open}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        )}
      </>
    );
  } else if (error)
    content = (
      <div role="alert">
        <p>{error}</p>
        <button onClick={() => setRetry((n) => n + 1)}>Try again</button>
      </div>
    );
  else if (!result) content = <p role="status">Loading reference…</p>;
  else if (view.type === "ccc" && "paragraph" in result) {
    source = result.paragraph.source_url;
    content = (
      <>
        <p className="ccc-panel-context">
          {result.paragraph.content?.context?.map((h) => h.text).join(" · ")}
        </p>
        <CatechismBody paragraph={result.paragraph} open={open} />
        <ParagraphReferences
          paragraph={result.paragraph}
          open={open}
          expanded
        />
      </>
    );
  } else if (view.type === "bible" && "passage" in result)
    content = (
      <>
        <p className="ccc-panel-context">{result.translation}</p>
        {result.passage.groups.map((group, i) => (
          <section key={i}>
            <h3>{group.book}</h3>
            {group.missing && (
              <p role="status">
                This passage is not fully available in the local Bible. Any
                available verses are shown below.
              </p>
            )}
            {group.verses.map((v) => (
              <p key={`${v.chapter}:${v.verse}`}>
                <sup className="ccc-verse-number">
                  {v.chapter}:{v.verse}
                </sup>{" "}
                {v.text}
              </p>
            ))}
          </section>
        ))}
      </>
    );
  return createPortal(
    <dialog
      ref={dialog}
      className="ccc-reference-panel"
      aria-labelledby="ccc-reference-title"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            close();
        }
      }}
    >
      <header className="ccc-panel-header">
        {stack.length > 1 && (
          <button
            aria-label="Back to previous reference"
            onClick={() => setStack((old) => old.slice(0, -1))}
          >
            <ArrowLeft size={19} />
          </button>
        )}
        <h2 ref={title} tabIndex={-1} id="ccc-reference-title">
          {heading}
        </h2>
        <button aria-label="Close references" onClick={close}>
          <X size={20} />
        </button>
      </header>
      <div ref={body} className="ccc-panel-body">
        {content}
      </div>
      <footer className="ccc-panel-footer">
        {result?.context_url && (
          <Link to={result.context_url} onClick={close}>
            Open in context <ArrowUpRight size={15} />
          </Link>
        )}
        {source && (
          <a href={source} target="_blank" rel="noopener noreferrer">
            Read original source <ArrowUpRight size={15} />
          </a>
        )}
      </footer>
    </dialog>,
    document.body,
  );
}
