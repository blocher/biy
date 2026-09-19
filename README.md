# Bible in a Year

A personal study companion for the **2025** Fr. Mike Schmitz podcast: Django 5.2, Django Ninja, PostgreSQL, React and TypeScript. The bright editorial interface was explored and converted with 12ui, then connected to real data and responsive reading controls.

## Start locally

Double-click **`dev-start.command`**, or run:

```sh
./dev-start.command
```

The launcher opens an iTerm window with Django, React, and Tools tabs and opens `http://127.0.0.1:5178/`. It checks PostgreSQL and existing port listeners first. It does not kill processes, install dependencies, import audio, or deploy anything. macOS may ask for permission to control iTerm the first time. `./dev-start.command --dry-run` prints the launch script without starting anything.

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

No public signup is exposed. Add another account using `create_account USERNAME`, which prompts for a password without echoing it. Production seeding creates `ben` with an unusable password; activate it with `changepassword` on the server.

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

**Only Day 1 has been imported. Do not run the full importer yet.** The publisher feed was inspected read-only: it contains 386 episodes dated in 2025, comprising 365 daily episodes and 21 supplementary episodes. Only selected entries are persisted.

```sh
.venv/bin/python backend/manage.py import_bible --day 1
.venv/bin/python backend/manage.py import_podcasts --day 1 --download-only
```

Set `OPENAI_API_KEY` privately in `.env`, then run the same single-day selection to transcribe and generate its study content:

```sh
.venv/bin/python backend/manage.py import_podcasts --day 1
.venv/bin/python backend/manage.py audit_episode --day 1 --output data/day-1-review.json
```

The `.env` also contains `OPENAI_TRANSCRIBE_MODEL=gpt-4o-transcribe-diarize` and `OPENAI_STUDY_MODEL=gpt-4.1`. The key is used only on the server/CLI and is never shipped to the frontend. No API calls occur when opening or reading the app. No key is currently bundled or committed.

The importer requires an explicit selector: `--day NUMBER`, `--guid FEED_GUID`, or `--all`. `--all` is the future bulk operation; it is implemented but **has not been run**. `--catalog-only` imports selected metadata without audio/AI. `--feed-file PATH` supports a cached publisher RSS feed. Supplementary episodes use the exact same pipeline and study screens, but their completion is separate from the 365-day total.

### How commentary-only extraction works

1. Download the original enclosure, validate audio with ffprobe, and retain its SHA-256 hash.
2. Transcribe three-minute audio chunks with diarized timestamps. Completed chunks are checkpointed so a retry does not transcribe them again. Speaker labels are local to each chunk; the app does not invent speaker identities.
3. Classify every source segment as Scripture reading, commentary, prayer, boilerplate introduction, advertisement, or mixed. Substantive section introductions and brief Bible quotations inside commentary are retained. Mixed excerpts must be exact substrings of their source segment.
4. Build commentary-only text from original retained segments. Keep the full transcript intact.
5. Generate a substantial lightly edited written version, one-paragraph summary, and outline. Every edited paragraph cites retained segment IDs; outline timestamps come from those source segments, not model-invented times.
6. Validate the output and mark the episode ready. AI text remains identified as AI-assisted and needs human comparison with the source audio. `audit_episode` exports a reviewable source/classification/edited-content bundle.

Files and checkpoints live under ignored `media/`. A PostgreSQL advisory lock prevents two concurrent importers from charging for the same episode. No bulk job, scheduler, or worker runs automatically.

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
