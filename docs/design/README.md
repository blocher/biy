# 12ui design provenance

Four visual directions were explored with 12ui. Candidate B was selected for its editorial cream/green palette, illustrated paper-cut landscape, readable serif headings, compact navigation and table structure.

- Draft directory: `12ui-personal-bible-in-a-EphzQd` (local temporary run).
- Branch: `crt-d39413a7c3ca87dc41ddc8dbc5852571b5d11514`.
- Home conversion: `e7d8264c-31b5-44a1-a797-fb1a64699c7c`; HTML export `4c9915a5-71d3-4974-a330-6a516caae16e`.
- Study page: `3abc3a7d-980e-4cf8-9942-f46901c5b264`.
- Reader package: `4233f406-5b9b-43f9-8b4f-217470309724`; page `f9b0beb1-2072-4d10-b97f-1576a8e3bb47`. Retried after the original branch conversion returned a network error.

The generated HTML documents and element IDs are retained in `frontend/src/design`, with their CSS and extracted images. `Design.tsx` binds the exported sections to real data and React controls. `styles.css` adapts fixed viewport anchors for growing transcripts, all 365 days, keyboard access and small screens. Source mockup names, dates, passages, progress and transcript excerpts are replaced with actual stored data. Generated mockup text is never a content source.

All period colors come directly from PDF fill colors. Conquest and Judges is a combined period; the repeated Messianic Checkpoints are preserved. Local full conversion artifacts are ignored under `docs/design`; reusable checked-in templates and assets live in the frontend.

## Collaborative leaderboard (2026-09-20)

The leaderboard uses candidate C from the community-progress design run, selected for its restrained table and comparison dropdown. Conversion `0f541002-f9bd-4321-b053-5a2d7ab3f8d3` and responsive HTML export `7b52067c-10f1-4292-a962-cef1cc9f9fa8` supply `frontend/src/design/leaderboard.html` and its scoped CSS. `Leaderboard.tsx` binds the existing app navigation, persisted comparison control, shared start date, and authenticated progress data. `leaderboard.css` adapts the converted document to the existing shell and readable mobile progress rows.

Study companion (September 20, 2026): 12ui candidate C, conversion `1e47084f-0964-4e70-8d49-ae35d53c655b`, HTML export `69a6dbd5-79fb-4ed5-8fcf-dcf2afeeda4e`. The exported companion section is retained in `frontend/src/design/chat.html` with runtime bindings for context, conversation, sources and composer. Fluid sizing and existing app typography replace screenshot coordinates; the existing navigation shell remains in use.

Reading companion dialog and sidebar (September 20, 2026): candidate D from `12ui-bible-in-a-year-UUIFJl`, conversion `3e8bc1a9-f774-4cfa-acdb-f5b44631fe4a`, HTML export `66c0fafe-bc5b-4bb6-9639-93b97fec83ae`. Extracted companion and chats groups are retained in `frontend/src/design/reading-chat.html`, prefixed to avoid collisions with the reusable chat surface. `ReadingChat.tsx` binds the exported header, answer and history groups to real data; native dialog semantics, fluid sizing, existing typefaces and the existing conversation component adapt the design to the reading page.
