# Validation — 2026-09-19

## Implemented and verified locally

- PostgreSQL database `biy`, all migrations applied and no pending model changes.
- Exactly **365 reading-plan records, one podcast episode (Day 1), and 70 RSV-2CE verses**. No supplementary or other daily episode was imported.
- Publisher feed inspected read-only: **386 episodes dated in 2025**, including 365 daily episodes and 21 extras. The importer tests publication dates in their original timezone and strips leading title whitespace before day matching.
- **13 Django tests passed**: plan idempotence, dates outside 2025, database year constraint, reference parsing, source Bible book order, annotation removal, private notes, session/CSRF authentication, idempotent completion timestamps, independent extra-episode completion, audio byte ranges, source-preserving AI classification and cache reuse.
- **2 frontend unit tests passed**; TypeScript and production Vite build passed; npm audit reports **zero vulnerabilities**.
- Real Chromium desktop/mobile smoke test passed: login; authenticated Day 1 audio; seek to 120 seconds; full-page reader and font size; journal save/reload/delete; day completion/reload/undo. No browser JavaScript errors. Desktop (1440px) and mobile (390px) checked for horizontal overflow.
- Separate browser-only fixtures verified full vs commentary-only transcript, edited prose, source-time playback, and supplementary episode/reader screens. These fixtures never write generated text or extra episodes to the real database.
- 12ui home, study and reader layouts were visually inspected. Fixed desktop anchor overflow, mobile spacing, long Scripture readability and reader audio placement.
- iTerm launcher dry run generated valid AppleScript (`osacompile` passed). The launcher was not executed because BIY dev servers were already running on its ports; it intentionally refuses to kill them.

## Not yet verified / not delivered live

- No live OpenAI transcription or study-generation request has run: `OPENAI_API_KEY` is empty. Day 1 audio is downloaded and plays; its transcript, summary, commentary extraction and edited prose remain pending. Mocked pipeline tests do not establish real transcription or editorial quality.
- Human listening review of Scripture/commentary boundaries remains part of the single-day acceptance test once the key is configured. Exact mixed excerpts and source references are validated programmatically, but the model can still misclassify content.
- Production files are prepared; **no production deployment or DNS changes have been made**. `biy.benlocher.com` currently resolves to `45.55.155.69`; Carnival's server is `104.237.147.195`.
- No Git remote was requested or created. Commits are local to this repository.

Browser acceptance notes and completion changes were removed after testing. The only seeded account is `ben`; its initial local password is stored in the ignored, mode-0600 `.env`.
