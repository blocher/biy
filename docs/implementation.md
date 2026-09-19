# Implementation decisions

Separate `Day` reading-plan records from `Episode` records: supplemental episodes receive the same study tools without inflating 365-day progress. Use the RSS publication date (including its original timezone) for the strict 2025 filter, not a title suffix or a feed update date. Keep supplementary entries even without a day number.

Preserve source transcript segments, their speaker labels, and audio offsets. Classify Scripture reading separately from commentary, prayer, introductions and advertisements. Commentary-only text is constructed from classified original segments; edited prose must refer back to retained commentary segments. Store generation provenance and explicit processing status; never manufacture content for unprocessed days.

Import the supplied Bible HTML as structured plain-text verses, stripping note markers and navigation. Preserve the plan exactly, including apparent duplicated readings, and document any edition/versification gaps instead of silently substituting readings.

Single-day acceptance: Day 1. No full podcast catalog/audio/AI importer run. Reading-plan seeding is permitted for all 365 days.
