# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-09-29

Initial public release.

### Added

- **Tasks:** title, summary, due and reminder times, priority, categories, tags,
  requester, client, and statuses `pending`, `in_progress`, `snoozed`, `done` and
  `shelved`. Tasks without a deadline are kept as general items.
- **Notes, steps and closing:** a timeline of notes, an ordered list of next steps and
  a closing message for whoever asked for the work.
- **Dependencies:** blocking links between tasks, with cycle and duplicate checks.
  A blocked task fires no reminders until its prerequisites are done or shelved.
- **Agent API:** ingest endpoints matched by keyword or id (`/api/ingest`, `note`,
  `steps`, `closing`, `personal`, `link`), REST endpoints for tasks and notes, and
  natural-language dates parsed server-side (English plus a few Italian forms).
- **Shell helpers** in `scripts/` for every common call, and **Claude Code skills**
  (`agenda`, `add-to-agenda`, `note-progress`, `set-next-steps`, `handoff-recap`,
  `delegate-prompt`, `tidy-agenda`) with an installer. `AGENTS.md` for any other agent.
- **Configuration store:** categories (services, apps, subjects) with icons and
  colors, people with avatars, clients with logos, reference shorthands that link
  `repo#N` to issues and pull requests, scopes, and reminder defaults. The app ships
  empty.
- **Setup:** first-run screen, a four-step setup wizard, a Settings page, an
  idempotent bootstrap endpoint, and a guide for agent-driven setup with an example
  config.
- **Views:** dashboard with progress and a 14-day outlook, week board, month
  calendar, timeline, and pages per category, requester, client, tag and status.
- **Reminders:** a background scheduler, snooze presets, browser notifications and
  optional native macOS notifications.
- **Study mode:** exam subjects with study windows, countdowns, pace, a timeline per
  exam, topic distribution, and a one-click student preset.
- **Live updates** over WebSocket.
- **Internationalization:** English and Italian UI, language switcher, one JSON file
  per language.
- **Self-hosting:** Docker Compose with a Bun + SQLite backend and a SvelteKit
  frontend, bound to localhost by default, with a CORS allowlist.
- **Phone layout:** the sidebar moves below the agenda on narrow screens.
- **Project:** demo seed data, CI (backend tests, frontend build, Docker build),
  issue and pull request templates, security policy.

[0.1.0]: https://github.com/giacorri/agent-agenda/releases/tag/v0.1.0
