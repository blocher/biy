# Reading-aware study companion

## Provider decision

OpenAI Responses orchestrates the app's narrowly scoped tools. Magisterium's published chat API documents messages, streaming and citations, but does not document arbitrary custom function calling. We therefore use its Chat Completions API as a grounded Catholic research tool, preserving the original citation text, author, document reference and URL. No dependency on undocumented Magisterium Search response fields is needed.

Source order is local Scripture/original retained Fr. Mike commentary/accessible journal, then Magisterium, then open web. Local search runs before generation. The web tool is exposed only after the Catholic-source tool has been attempted. Missing keys/provider failures are explicit; outside references never masquerade as imported commentary. External sources can be disabled for each message.

Official contracts checked September 20, 2026:
- https://www.magisterium.com/developers/docs/chat
- https://www.magisterium.com/developers/docs/chat/citations
- https://www.magisterium.com/developers/docs/search/api-reference
- https://developers.openai.com/api/docs/guides/function-calling
- https://developers.openai.com/api/docs/guides/tools-web-search

## Index and queue

PostgreSQL + pgvector holds current source excerpts and embeddings. Full-text and exact cosine rankings are combined with reciprocal rank fusion. Exact search avoids approximate-index filtering pitfalls for this small corpus. Scripture uses eight-verse excerpts; commentary retains source segment IDs and timestamps; long notes are split into bounded excerpts.

Saving a note or episode updates local excerpts synchronously without provider calls. Bible imports reconcile changed chapters within the import transaction. Changed excerpts are immediately available through lexical search and queued for embedding. Unchanged hashes preserve their embeddings. `index_study` reconciles existing records without making AI calls; run it after loading fixtures or bulk updates that bypass model signals. Deletions cascade from note/episode records.

`study_worker` polls PostgreSQL, prioritizes a chat then processes up to 32 embeddings. `SELECT FOR UPDATE SKIP LOCKED` coordinates workers; embeddings use three-minute leases and digest checks, so killed jobs are reclaimed and stale responses cannot overwrite edits. Failures back off and stop after eight attempts. `index_study --retry-failed` requeues them. Changing the configured embedding model triggers re-embedding; dimensions stay fixed at 1536.

Chat runs outside HTTP requests; the browser polls persisted status. Each member has at most one queued/running answer, a configurable daily limit, idempotent request UUIDs, seven model rounds and bounded output. Interrupted chat requests fail after eight minutes rather than silently repeating paid calls. Chats are private to their owner and can be deleted.

## Context, permissions and privacy

Current day/episode and actual completed days are supplied per turn. Calendar yesterday, last completed reading, previous plan day and biblical chronology are distinct. The full imported Bible is available; there is no spoiler cutoff. Unimported passages/commentary remain unavailable.

Search permissions join current Note ownership/sharing flags, not copied index ACLs. Prior answers are withheld and excluded from model context when an underlying excerpt changes, disappears, or loses access. This cannot retract text a member already read. All retrieved local evidence (including uncited excerpts) is retained for this access check. Source text is untrusted and cannot grant tool permissions.

Selected local excerpts and conversation context are sent to OpenAI to compose answers; saved notes are sent to OpenAI for embedding. `store=False` is set on Responses calls; this is not a claim of zero provider retention. Magisterium/web receive only a general topic produced in a separate call from the current question, without retrieved journal text, member profile, or prior answers. Topic sanitization is model-based, not a formal privacy guarantee. Keep external sources off for especially sensitive questions.

## Operations

Install pgvector for the PostgreSQL major version used by BIY. On macOS the local PostgreSQL installation must list `vector` in `pg_available_extensions`; on Ubuntu use the matching `postgresql-<major>-pgvector` package. A database administrator creates the extension in the BIY database; do not grant the runtime role superuser privileges. The schema migration also uses `VectorExtension` for fresh local/test databases.

Configure `OPENAI_API_KEY`, `MAGISTERIUM_API_KEY`, `STUDY_CHAT_MODEL`, `STUDY_CHAT_QUALITY_MODEL`, `STUDY_WEB_MODEL`, and `STUDY_EMBEDDING_MODEL` in the protected environment. Defaults are `gpt-5.6-luna` for direct chat questions, `gpt-5.6-terra` for synthesis-heavy questions, and `text-embedding-3-small` for 1536-dimensional embeddings. `OPENAI_STUDY_MODEL` remains the Terra-class model used for episode study-content generation. No secrets are sent to the browser.

Local startup: `StartBIYDev.app` opens a Study Worker pane that migrates, reconciles the index, then runs `study_worker`. PostgreSQL remains the app's existing prerequisite; no Redis/Celery daemon is required. For manual startup:

```sh
.venv/bin/python backend/manage.py migrate
.venv/bin/python backend/manage.py index_study
.venv/bin/python backend/manage.py study_worker
```

Import the complete local Bible once with `import_bible` (no `--day`) for whole-Bible coverage. Importing podcasts remains explicit; the worker never starts podcast imports.

Production: `deploy/biy-worker.service` runs independently with restart-on-failure and a graceful shutdown window. The deployment hook stops web/worker before migrations, creates the extension as postgres, reconciles excerpts, installs/enables the worker service, then starts and checks both services. Install the pgvector OS package before deploying. Monitor `systemctl status biy-worker`, `journalctl -u biy-worker`, authenticated `/api/chat/status`, and pending/failed chunk counts. Deployment configuration changes do not themselves deploy production.

## Validation

`manage.py test study` includes cross-member access, immediate unsharing/deletion invalidation, stale embedding responses, retries/lease recovery, CSRF, idempotency, daily limits, interrupted jobs, and external-tool ordering. Provider calls are mocked in unit tests. The browser acceptance script `frontend/tests/chat-smoke.mjs` makes a real site-only chat request and checks citations, saved history, and desktop/mobile overflow. It uses `BIY_CHAT_SMOKE_ACCOUNT` (path to a private JSON file containing username/password) or the original local acceptance credentials; run only against local development. Real OpenAI answer generation, embeddings and web search were checked. Magisterium remains contract-tested until its key is configured.

## Reading context and member notes

Notes inherit their parent day's reading references (including notes attached through an episode). This context is searchable and embedded alongside the unchanged note text. Saving a day or episode refreshes dependent note context. Existing notes are reconciled with `index_study` after deployment.

`get_reading_notes` enumerates accessible notes by day, episode, or overlapping passage ranges across the reading plan. It returns visible-note counts, missing-index counts and paginated evidence independently of vector ranking. The assistant must use this lookup for passage-specific community questions before claiming absence. Attachment to a day is not proof that a note discusses every passage on that day; answers must distinguish the two. Full-text candidates require an actual PostgreSQL text-search match, not just a positive rank (nonmatches can have tiny positive scores).

Reading pages and reader mode open the same companion in a native modal dialog, preserving the reading URL and position. Conversations created there retain the day/episode. The right reading sidebar lists the signed-in member's recent chats for that reading; `/chat` provides their broader conversation history. Server-side owner checks apply to listing, reopening, and deletion.

Local browser acceptance: `BIY_CHAT_SMOKE_ACCOUNT=/path/to/private-test-account.json node tests/chat-reading.mjs` from `frontend/` checks the real Genesis 1/Fiat Lux regression, saved history, day isolation, modal keyboard/focus behavior, reading URL preservation, mobile layout and citation navigation. Use a disposable account and remove it afterward; this creates a paid, site-only answer.
