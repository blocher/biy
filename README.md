# Bible and Catechism in a Year

A personal study companion for the complete **2025** editions of Fr. Mike Schmitz's Bible in a Year and Catechism in a Year podcasts: Django 5.2, Django Ninja, PostgreSQL, React and TypeScript. Each account can show either journey or both, with independent reading progress, schedules, and leaderboards.

## Offline reading (first pass)

After signing in while connected, keep the app open until it says the enabled Bible and/or Catechism readings are ready offline. The app automatically saves every enabled day's Scripture or Catechism text, any episode commentary and transcripts currently available from the server, and supplementary episode text. An interrupted download resumes on the next connected visit or with **Retry**. The app shell and saved readings then open after a cold restart without a connection, including in standalone PWA mode. Signing out removes private offline copies from that device.

Audio, the separate historical commentary catalog, linked Scripture/Catechism reference previews, Ask, and search that needs the server are not part of the offline pack. Notes and progress changes still require a connection; the app does not queue unsaved edits. Device storage can be cleared by the browser or operating system, so check the readiness message before travel.

## Start locally

Double-click **`StartBIYDev.app`** in Finder. Its editable source is
**`StartBIYDev.applescript`**, following the same launcher structure as the
other local projects. The legacy command wrapper also opens the app:

```sh
./dev-start.command
```

The launcher replaces only a prior BIY-tagged iTerm window, then opens one
iTerm window with stacked Django, React, and Import / Tools panes and opens
`http://localhost:5178/` in Chrome. The tools pane prints the single-day,
catalog-only, and resumable full-import commands. It does not kill unrelated
port listeners, install dependencies, start an import, or deploy anything.
macOS may ask for permission to control iTerm the first time.

After editing the source, rebuild the application with:

```bash
osacompile -o StartBIYDev.app StartBIYDev.applescript
```

For manual startup:

```sh
.venv/bin/python backend/manage.py runserver 127.0.0.1:8017
# In another terminal:
cd frontend
npm run dev
```

The local `ben` account is active. Its generated initial password is stored privately as `BEN_INITIAL_PASSWORD` in the ignored `.env`. Change it with:

```sh
.venv/bin/python backend/manage.py changepassword ben
```

No public signup is exposed. The seeded `ben` account is an administrator and can manage member accounts and complete profiles from the admin-only **People** page in the app. From a terminal, `create_account USERNAME` prompts for a password without echoing it; add `--admin` when the new account should also manage members. Production seeding creates `ben` with an unusable password; activate it with `changepassword` on the server.

## Fresh setup

Install Python 3.13, Node 22.12+ (or 24+), PostgreSQL, ffmpeg, and Poppler (`pdftotext`, for re-extracting the plan).

```sh
uv venv --python 3.13 .venv
uv pip sync backend/requirements.txt
cp .env.example .env
# Set a random DJANGO_SECRET_KEY and your local DATABASE_URL privately.
createdb biy
.venv/bin/python backend/manage.py migrate
.venv/bin/python backend/manage.py seed_plan
.venv/bin/python backend/manage.py seed_catechism_plan
.venv/bin/python backend/manage.py create_account ben
cd frontend
npm ci
```

The historical commentary browser imports the compiled SQLite release from
[HistoricalChristianFaith/Commentaries-Database](https://github.com/HistoricalChristianFaith/Commentaries-Database)
into the primary database. Keep the downloaded export outside the repository,
then run:

```sh
.venv/bin/python backend/manage.py import_commentaries /path/to/commentaries.sqlite
```

Use `--replace` only when intentionally rebuilding the imported catalog. The
browser matches inclusive verse-span overlap using the export's modern book
keys, presents the app's RSV-2CE readings, sorts dated sources oldest first,
and keeps unknown dates at the end. Its deuterocanonical matching note is
deliberately visible in the browser because some historical sources use a
different chapter layout for additions to Daniel and Esther.

Both 365-day plans come from their supplied official PDFs. Reading references are preserved exactly, including the Bible plan's repeated Ecclesiastes reading on days 150/151 and unusual Esther chapter ordering. The Catechism plan covers CCC 1-2865 exactly once, with its four introductory days retained as days without numbered paragraphs. The importer does not silently correct either source plan.

The Catechism reader uses Ascension's structured text, including paragraph boundaries,
headings, quotations, complete footnotes, Bible citations, and CCC cross-references.
Reference previews use the local Bible and Catechism. Document citations retain their
original wording; this feature makes no Magisterium or other document-service calls.

After seeding the plan and applying migrations, capture an immutable source snapshot,
then preview the import (no database writes):

```sh
.venv/bin/python backend/manage.py fetch_catechism --output data/catechism/source.json
.venv/bin/python backend/manage.py import_catechism --source data/catechism/source.json --report data/catechism/preview.json
```

Review the report before applying. It lists text changes, structure changes,
unplaced notes, and unresolved Bible citations. Source snapshots retain their URL,
retrieval time, and checksum; use a fresh filename for each fetch. The importer
requires CCC 1–2865 exactly once, rejects unsupported markup and missing footnotes,
and keeps supplemental publisher material out of the canonical reading.

```sh
.venv/bin/python backend/manage.py import_catechism --source data/catechism/source.json --report data/catechism/applied.json --apply --backup data/catechism/before-import.json
```

This updates paragraph content in place and preserves days, progress, notes, and
paragraph links. Audio alignment uses the derived plain text, excluding headings
and reference markers. It does not generate audio or queue AI work. Add
`--index-for-ask` only when refreshing semantic indexing is intentionally authorized;
existing Ask chunks otherwise retain their previous text until explicitly reindexed.
Raw source snapshots and backups are ignored by Git.

Rollback also requires a new backup of the current state:

```sh
.venv/bin/python backend/manage.py import_catechism --restore --source data/catechism/before-import.json --report data/catechism/restored.json --apply --backup data/catechism/before-restore.json
```

The legacy plain-text Vatican importer is available as `import_catechism_vatican`
for old mirrors and parser fixtures. It refuses to overwrite structured content.
The 2026-10-03 Ascension snapshot contains 2,865 paragraphs, 3,744 footnotes, and
3,123 CCC cross-references. One malformed citation, `1 Jn 2:20:27` at CCC 695,
is preserved as readable text and reported as unresolved rather than guessed.

## One-day acceptance import

**The original acceptance import covered Day 1. Podcast bulk imports remain explicit.** The publisher feed was inspected read-only: it contains 386 episodes dated in 2025, comprising 365 daily episodes and 21 supplementary episodes. Only selected entries are persisted.

```sh
.venv/bin/python backend/manage.py import_bible --day 1
.venv/bin/python backend/manage.py import_podcasts --day 1 --download-only
```

Set `OPENAI_API_KEY` privately in `.env`, then run the same single-day selection to transcribe and generate its study content:

```sh
.venv/bin/python backend/manage.py import_podcasts --day 1
.venv/bin/python backend/manage.py audit_episode --day 1 --output data/day-1-review.json
```

The `.env` also contains `OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize` and `OPENAI_STUDY_MODEL=gpt-6-astra`. The diarization model provides timestamped speaker attribution; Astra is used for classification, summarization, outlining, and polished prose. The key is used only on the server/CLI and is never shipped to the frontend. No AI calls occur just from opening or reading the app. Study chat and background search indexing use the configured AI providers. No key is currently bundled or committed.

The importer requires an explicit selector: `--day NUMBER`, `--guid FEED_GUID`, or `--all`. `--all` is the future bulk operation; it is implemented but **has not been run**. `--catalog-only` imports selected metadata without audio/AI. `--feed-file PATH` supports a cached publisher RSS feed. Supplementary episodes use the exact same pipeline and study screens, but their completion is separate from the 365-day total.

Catechism imports use the same explicit stages. For the current manual one-day test, first catalog Day 1 without downloading media or invoking AI:

```sh
.venv/bin/python backend/manage.py import_podcasts \
  --edition catechism --day 1 --catalog-only
```

When a one-day audio download is intentionally desired, this command downloads only that episode and exits before transcription or study-content generation:

```sh
.venv/bin/python backend/manage.py import_podcasts \
  --edition catechism --day 1 --download-only
```

Do not omit `--download-only` for the local manual Catechism test unless local AI spend is intentional: without a stage flag, the importer proceeds to transcription and AI study generation after downloading. A full, explicitly selected Catechism import is permitted in production; see the production command reference. No scheduler or deployment hook runs podcast imports automatically.

For a bulk run, `--workers 2` through `--workers 8` process separate episodes concurrently; the default remains one worker. Start with two workers, then increase only if the host, publisher, and OpenAI account remain healthy. Each episode retains its own advisory lock and resumable checkpoints, so a rerun continues completed work without repeating it. For example: `.venv/bin/python backend/manage.py import_podcasts --all --workers 2`. To regenerate only the summary, key points, outline, and edited commentary for an already-transcribed episode, add `--force-study`; audio and transcription are reused, and structured AI generation is attempted up to three times with exponential backoff.

### How commentary-only extraction works

1. Download the original enclosure, validate audio with ffprobe, and retain its SHA-256 hash.
2. Transcribe 15-minute audio chunks with a four-second overlap and diarized timestamps. Completed chunks are checkpointed so a retry does not transcribe them again; repeated overlap segments are deduplicated. Speaker labels are local to each chunk; the app does not invent speaker identities.
3. Classify every source segment as Scripture reading, commentary, prayer, boilerplate introduction, advertisement, or mixed. Substantive section introductions and brief Bible quotations inside commentary are retained. Mixed excerpts must be exact substrings of their source segment.
4. Build commentary-only text from original retained segments. Keep the full transcript intact.
5. Generate a substantial lightly edited written version, one-paragraph summary, and outline. Every edited paragraph cites retained segment IDs; outline timestamps come from those source segments, not model-invented times.
6. Validate the output and mark the episode ready. AI text remains identified as AI-assisted and needs human comparison with the source audio. `audit_episode` exports a reviewable source/classification/edited-content bundle.

Files and checkpoints live under ignored `media/`. A PostgreSQL advisory lock prevents two concurrent importers from charging for the same episode. No bulk job or scheduler runs automatically.

## Study experience

- The top-level edition switch moves between Bible in a Year and Catechism in a Year. Account settings can show either one or both; both are enabled by default.
- Home shows the day list, completion checks, progress and a prominent next-unread action.
- Search by day/book/title, filter by period/completion, and switch between table and cards.
- Each day includes RSV-2CE Scripture, full transcript, commentary-only transcript, lightly edited commentary, summary and clickable audio outline.
- The light/dark toggle is available in navigation, reader mode, and sign-in. Appearance follows the device until you choose a theme; Account → Appearance can restore the device setting. The choice is saved in this browser and shared between its tabs.
- Full-page reader supports text sizing; the audio player supports seeking, 15-second skip, speed control and saved position.
- The reading plus menu offers Take a note, Ask, Find on this page, and Search the site. Selecting text keeps only Take note and Ask. Page find marks case-insensitive matches throughout visible page content, including summaries and outlines; highlights stay anchored to the text while scrolling or changing text size; in an installed app, Ctrl/Cmd+F opens it. Site search keeps results in a modal until a link is chosen. It ranks PostgreSQL full-text matches and typo-tolerant matches across accessible readings, episode and historical commentary, and permitted notes. Search does not call an AI model or use embeddings; another member's private notes are excluded.
- Notes and journal entries are private per account, editable and optionally linked to the current audio time. Unsaved text is kept in that browser tab until saved. The journal collects entries across the year.
- Completion timestamps persist and repeated “complete” calls preserve the original timestamp. A day can be marked unread again.
- Unimported days show explicit availability states and never fabricated transcripts or summaries.
- Catechism days show the official Vatican text by numbered paragraph. Processed episodes expose verified reading audio with day and paragraph play/pause/resume controls, paragraph links in reader mode, and explicit partial/unavailable states. Playback uses the existing podcast; it never generates new audio. Cue boundaries have transcript-segment precision, and mixed commentary/reading segments without exact timestamps are omitted. Its two 2025 bonus episodes appear after Day 365 and do not count toward yearly progress.
- Journal and leaderboard views can switch editions; Ask searches both corpora while preferring the active edition.

## Verification

```sh
.venv/bin/python backend/manage.py test study --noinput
cd frontend
npm test
npm run build
# Isolated, mocked reading-selection checks; starts its own Vite server:
npm run test:selection
# Isolated page-wide find behavior and painted geometry (Chromium + WebKit):
npm run test:find-page
# With the two dev servers running and local BEN_INITIAL_PASSWORD configured:
node tests/smoke.mjs
```

Catechism audio acceptance uses mocked API responses and media events, so it requires only a frontend dev server and never changes an account, downloads a podcast, or invokes AI:

```sh
cd frontend
npm run dev -- --port 5183 --strictPort
# In another terminal, after installing Playwright Chromium/Chrome and WebKit:
BIY_TEST_URL=http://127.0.0.1:5183 npm run test:catechism-audio
```

It checks desktop Chromium and mobile WebKit, reading/paragraph navigation, pause/resume, end-of-reading replay, commentary gaps, load errors/retry, and unavailable/introductory days. Screenshots go to `/tmp/biy-catechism-audio` (override with `BIY_TEST_OUTPUT`). Actual podcast alignment still needs a processed episode; the test intentionally does not create one.

The browser smoke test signs in, checks the layout, plays/seeks Day 1, opens reader mode, saves/reloads/deletes an acceptance-test journal entry, and completes/reloads/uncompletes Day 1. Run only against the initial local test account; it changes Day 1’s completion state. It does not call OpenAI.

The theme acceptance suite uses mocked APIs and silent test audio, with no account or database changes. With Vite running on port 5181, run `node tests/theme.mjs` from `frontend` (Chromium/Chrome and Playwright WebKit must be installed). Override `BIY_TEST_URL` for another local port or set `BIY_TEST_BROWSER=chromium` / `webkit` for one engine. It checks persistence, device and cross-tab changes, keyboard controls, contrast, and 320/390px reader, dialog, and audio surfaces; screenshots are saved under ignored `data/screenshots/theme/`.

The selection acceptance test uses the real reading toolbar and note dialog with
mocked chat and API calls, without signing in or changing a database. It checks
desktop keyboard selection and touch layouts at 390px and 320px, including
collapsed native ranges, handle changes, note metadata, scrolling, visual viewport
changes, dismissal, navigation and unmounting. Screenshots go to ignored
`data/screenshots/selection/`. With a compatible Playwright WebKit engine installed,
run `SELECTION_BROWSER=webkit npm run test:selection` for the same WebKit checks.
Headless emulation cannot display the iPhone's native selection menu. On a real
iPhone, select text near both ends of the screen, adjust its handles, scroll or
rotate, then use **Take note** and **Ask** to confirm the quote and citation. The
touch toolbar docks at the opposite visible edge and its close button discards
the retained selection; native **Copy** and **Look Up** remain available.

## Deployment

Target: **biy.benlocher.com**, using the isolated Carnival-style systemd/Gunicorn/Nginx deployment, with a dedicated PostgreSQL database. Deployment files are prepared; see [deployment instructions](docs/deployment.md) and [validation results](docs/validation.md). Production deployment and DNS changes are not included in a local commit.

Source plan: the supplied `the-official-365-day-reading-plan-for-the-bible-in-a-year_0.pdf`. Scripture edition verified from the supplied app’s `copyrights.html`: Revised Standard Version, Second Catholic Edition. Publisher feed discovered through Apple’s listing: `https://feeds.fireside.fm/bibleinayear/rss`.

### Community features

Signed-in members can view the leaderboard, unless someone disables **Show my progress on the leaderboard** in Account. Current day is the first unread day; ranking uses completed reading days. Supplementary episodes do not count. Schedule comparisons use completed days against elapsed calendar days, capped at 365.

The homepage and leaderboard save the same account preference: **Personal start dates** (default, measured from each person's earliest completion), **Leaderboard start date**, or **January 1** of the current year. Members who have not completed anything have no personal schedule yet.

The shared leaderboard date initially defaults to `2026-09-20` (override with `LEADERBOARD_START_DATE` before first use). It is then stored in the database. Any signed-in member can change it in Account, with a prominent warning and explicit confirmation that the change affects everyone. This permission is intentional for the trusted v1 group.

Notes and journal entries remain private by default. Authors can mark an entry **Shared**, or make it private again. Shared entries are available only to signed-in members, on their associated day/episode and in the journal's **Community entries** tab, which supports filtering by person. Only the author can edit/delete an entry. Leaderboard opt-out does not hide explicitly shared entries.

Optional email uses the same Django SMTP environment variable setup as Therapy2.0. Configure `DJANGO_EMAIL_HOST`, `DJANGO_EMAIL_PORT`, `DJANGO_EMAIL_HOST_USER`, `DJANGO_EMAIL_HOST_PASSWORD`, `DJANGO_EMAIL_USE_TLS`, `DJANGO_DEFAULT_FROM_EMAIL`, and `PUBLIC_APP_URL`. Missing host, credentials, or sender skips sending entirely. The default `BIY_EMAIL_DELIVERY_MODE=redirect` sends only to `DJANGO_EMAIL_REDIRECT_TO`; set `BIY_EMAIL_DELIVERY_MODE=production` to deliver to actual recipients. Each active member with an email address receives a separate message, unless they disable notifications in Account. Email contains a link, not the reflection's contents.

Notifications are attempted after the first share commits, including when an existing private entry is first shared. Editing or re-sharing does not repeat notifications. Delivery failures are logged without failing the save; v1 does not queue retries or backfill notifications skipped while email was unconfigured. Apply database migrations before running the updated app.

### Study companion

Ask questions from any reading or open **Study chat**. Answers search imported Scripture, original Fr. Mike commentary and accessible journals first; optional external research consults Magisterium, then the open web. Citations open the exact excerpt and link to its reading/audio location where available. Conversations remain private to their owner.

The full local Bible can be imported with `import_bible` without `--day`; podcast imports remain explicit. Set `MAGISTERIUM_API_KEY` privately to enable Catholic research. The UI reports missing configuration and worker availability.

Local startup now includes a PostgreSQL-backed Study Worker pane for chat and asynchronous embeddings; no Redis is required. Production has a dedicated `biy-worker` service integrated into the deployment hook. Install pgvector for your PostgreSQL version before migrating. See [study chat architecture and operations](docs/study-chat.md).

See the [production command reference](docs/production-commands.md) for seeding, podcast imports, AI processing, and service checks.
