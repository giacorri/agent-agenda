# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.0] - 2026-10-26

### Added

- **Focus view:** `/focus/<id>`, a read-only, phone-width page for one task: notes as a
  live journal, the first next step pinned at the bottom and struck off when done.
- **cmux focus pane (opt-in):** with `AGENDA_CMUX_FOCUS=1`, a plugin hook opens the focus
  view in a narrow cmux browser pane next to the agent and follows the task it works on.

## [0.2.0] - 2026-10-26

### Added

- **People on a task:** tag people besides the requester; a person's page lists the
  tasks they asked for or are tagged on.
- **Gantt timeline:** a second timeline mode that plots open work on a time axis
  around due days, with zoom, closed tasks on demand and a resizable task column.
- **Updating:** README and self-hosting guide explain how to update an existing install.

### Changed

- **Timeline:** redesigned as a day-by-day list of open work.
- **Sidebar:** the requesters heading is now "People".
- **Claude Code plugin:** the skills and helper scripts ship as the `agent-agenda`
  plugin from this repository's marketplace (`claude plugin marketplace add` +
  `claude plugin install`). Skills moved from `.claude/skills/` to `skills/`, with
  shorter descriptions. `scripts/install-claude-skills.sh` is removed.

### Fixed

- **Filtered pages:** the person, client, service and tag pages no longer crash on
  tasks with a due date, which left the previous page's cards on screen.
- **Date-only due dates** are read as a local calendar day everywhere.
- **In-progress status** is tracked, and cards without notes show their description.
- **Gantt hover card** renders markdown in the summary.
- **Skill descriptions** keep hyphenated skill names whole.

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

[Unreleased]: https://github.com/giacorri/agent-agenda/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/giacorri/agent-agenda/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/giacorri/agent-agenda/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/giacorri/agent-agenda/releases/tag/v0.1.0
