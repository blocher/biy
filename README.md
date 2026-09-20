# Bible in a Year

A personal study companion for the **2025** Fr. Mike Schmitz podcast: Django 5.2, Django Ninja, PostgreSQL, React and TypeScript. The bright editorial interface was explored and converted with 12ui, then connected to real data and responsive reading controls.

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
.venv/bin/python backend/manage.py create_account ben
cd frontend
npm ci
```

All 365 day records come from the supplied official PDF. Reading references are preserved exactly, including the repeated Ecclesiastes reading on days 150/151 and unusual Esther chapter ordering. The importer does not silently correct the source plan.

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

- Home shows the day list, completion checks, progress and a prominent next-unread action.
- Search by day/book/title, filter by period/completion, and switch between table and cards.
- Each day includes RSV-2CE Scripture, full transcript, commentary-only transcript, lightly edited commentary, summary and clickable audio outline.
- Full-page reader supports text sizing; the audio player supports seeking, 15-second skip, speed control and saved position.
- Notes and journal entries are private per account, editable and optionally linked to the current audio time. Unsaved text is kept in that browser tab until saved. The journal collects entries across the year.
- Completion timestamps persist and repeated “complete” calls preserve the original timestamp. A day can be marked unread again.
- Unimported days show explicit availability states and never fabricated transcripts or summaries.

## Verification

```sh
.venv/bin/python backend/manage.py test study --noinput
cd frontend
npm test
npm run build
# With the two dev servers running and local BEN_INITIAL_PASSWORD configured:
node tests/smoke.mjs
```

The browser smoke test signs in, checks the layout, plays/seeks Day 1, opens reader mode, saves/reloads/deletes an acceptance-test journal entry, and completes/reloads/uncompletes Day 1. Run only against the initial local test account; it changes Day 1’s completion state. It does not call OpenAI.

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
