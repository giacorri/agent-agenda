# Agenda skills

These skills ship as the `agent-agenda` Claude Code plugin and let an agent drive *your* connected `agent-agenda` from any project. They are generic and
config-driven: categories, requesters, ref shorthands and scopes come from the
running agenda's `/api/config`, never hardcoded.

## What's here

| Skill | Purpose | Helper / endpoint |
|---|---|---|
| `agenda` | Read/resume the shared agenda and route to the right write skill | `list-tasks.sh` / `show-task.sh` / config endpoints |
| `add-to-agenda` | Capture a task (the core "remember this") | `add-task.sh` → `POST /api/ingest` |
| `note-progress` | Append one timeline note when a milestone happens | `add-note.sh` → `POST /api/ingest/note` |
| `set-next-steps` | Replace the forward plan (full, ordered list) | `set-steps.sh` → `POST /api/ingest/steps` |
| `handoff-recap` | Save the closing message of a closed topic | `set-closing.sh` → `POST /api/ingest/closing` |
| `delegate-prompt` | Produce a copy-paste prompt to delegate a task (read-only) | none |
| `tidy-agenda` | Verify, close, condense notes, merge duplicates, resume a theme | task/notes endpoints |

The model behind them: a task has **three planes** — description (what it is),
**next steps** (the ordered forward plan), and **notes** (the backward timeline).
One note = one milestone, logged the same turn it happens; each note is
self-contained (headline + short story).

## Install

```bash
claude plugin marketplace add giacorri/agent-agenda
claude plugin install agent-agenda@agent-agenda
```

The skills show up as `agent-agenda:<name>` (for example `/agent-agenda:agenda`), and
the helper scripts are on the Bash tool's `PATH` while the plugin is enabled, so
nothing goes into `~/.local/bin`. The plugin has no pinned version: it tracks this
repository's commits. Pull updates with `claude plugin marketplace update agent-agenda`
followed by `claude plugin update agent-agenda@agent-agenda`, or turn on auto-update for
the marketplace in `/plugin`. To hack on the skills, add the marketplace from a local
clone instead (`claude plugin marketplace add ./agent-agenda`): the plugin then loads in
place and every edit applies at the next session or `/reload-plugins`.

Other agents can copy a skill folder into their own skills directory and put the
repo's `scripts/` on `PATH`.

Each folder is a self-contained skill (`SKILL.md` with YAML frontmatter). Adapt the
descriptions and wording to your own voice if you like — the structure and the
endpoints are what matter.

## Requirements

- A running `agent-agenda` backend reachable at `$AGENDA_URL` (default
  `http://localhost:4010`).
- The helper scripts: bundled with the plugin; outside it, the repo's `scripts/` on
  `PATH`, or post directly to the endpoints above.
- `jq` for the optional read-back snippets in `handoff-recap` and `delegate-prompt`.

Run the agenda's config setup first (or via the app's settings UI) so the skills
read real categories and people from `/api/config`. On a fresh, unconfigured
install the skills still work — they fall back to free-form tags and skip
`--service` / `--requester`.
