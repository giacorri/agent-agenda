# Agenda skills (templates)

These are **template skills** you install into your own agent's skills directory to
let it drive *your* connected `agent-agenda` from any project. They are generic and
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

Use the repo installer. It copies the managed skill folders into Claude Code's
user-level skills directory and links the agenda helper scripts into `~/.local/bin`:

```bash
scripts/install-claude-skills.sh
```

Manual install is also possible. Copy the skill folders you want into your agent's
skills directory. For Claude Code that is `~/.claude/skills/` (user-level) or
`<project>/.claude/skills/` (project-level):

```bash
cp -r agenda add-to-agenda note-progress set-next-steps handoff-recap delegate-prompt tidy-agenda ~/.claude/skills/
```

Each folder is a self-contained skill (`SKILL.md` with YAML frontmatter). Adapt the
descriptions and wording to your own voice if you like — the structure and the
endpoints are what matter.

## Requirements

- A running `agent-agenda` backend reachable at `$AGENDA_URL` (default
  `http://localhost:4010`).
- The agenda `scripts/` helpers (`add-task.sh`, `add-note.sh`, `set-steps.sh`,
  `set-closing.sh`, and the read-back `list-tasks.sh` / `show-task.sh`) on your
  `PATH`, **or** call them by full path / post directly to the endpoints above.
- `jq` for the optional read-back snippets in `handoff-recap` and `delegate-prompt`.

Run the agenda's config setup first (or via the app's settings UI) so the skills
read real categories and people from `/api/config`. On a fresh, unconfigured
install the skills still work — they fall back to free-form tags and skip
`--service` / `--requester`.
