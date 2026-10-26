---
name: tidy-agenda
description: |
  Clean up the connected agent-agenda one theme at a time: verify what is really
  done and close it, condense notes, simplify steps and titles, merge duplicate
  threads, hand back a prompt to resume a theme. Use for "tidy the agenda", "clean
  up the agenda", "what's overdue" (in any language), or when the open list is long
  and noisy.
---

# tidy-agenda — verify, close, condense, merge, resume

The agenda drifts: tasks stay open after the work shipped, notes pile up as a diary,
steps go stale, the same thread lives in three cards. This skill brings it back to a
list the user can read at a glance. Companion of `agenda` (read it first for the
model: notes = past, steps = future, closing = handoff).

## 0. Snapshot first

Dump every open task (with notes) to a scratch folder before touching anything —
condensing deletes notes, and the dump is the only undo:

```bash
: "${AGENDA_URL:=http://localhost:4010}"
SCRATCH="${SCRATCH:-$(mktemp -d)}"; mkdir -p "$SCRATCH/agenda-backup"
for id in $(curl -s "$AGENDA_URL/api/tasks" | jq -r '.[]|select(.status=="pending" or .status=="in_progress")|.id'); do
  curl -s "$AGENDA_URL/api/tasks/$id" > "$SCRATCH/agenda-backup/$id.json"
done
```

Take a second snapshot before any later bulk rewrite.

## 1. Verify online, in parallel, read-only

Split the open tasks into **themes** (by category/area: auth, import, security,
CI, customers, personal…) and give each theme to a subagent. The subagent:

- reads the task JSON; checks the **current** state of every issue/PR it cites
  (`gh pr view` / `gh issue view`), not what the notes claim;
- proposes, per task, a JSON file: `verdict` (`open` / `done` / `shelved`),
  one-line evidence, the condensed note, ≤4 steps, a realistic `due_at` if overdue,
  and `merge_into` (another open task id) only for a clear overlap;
- **writes nothing** to the agenda or to GitHub. Central application keeps it
  consistent and lets the user veto.

Tell subagents the note style below verbatim — a paraphrase loses it.

## 2. Rules the user set (apply without re-asking)

- **Code merged / in production = closed**, unless a test on staging is genuinely required.
  Leftover "try it", "tell X" or "answer Y" steps don't keep a task open; the
  follow-up lives in its issue.
- **Merge only the same thread with the same requester.** A task that is merely
  *blocked* by another, but asked by someone else, stays separate (it is that
  person's card). Literal duplicates (same steps) always merge.
- **Merge mechanics:** copy the absorbed task's notes to the container as separate
  notes, move its still-open steps over (≤4 total), close the absorbed task with a
  one-line note linking the container.
- **Review with the user one theme at a time**: short proposal (what closes, what
  merges and why in one line), then apply on "ok". Surface urgent findings
  (expired certificates, security settings) immediately, not at the end.
- Public side effects (closing an issue, a comment) only on the user's go; follow
  the repo's comment conventions.

## 3. Note style (the whole point)

The timeline is the history: **one note per fact**, never one note that collects them.
Tidy it note by note — rewrite each note worth keeping as **one short past-tense
sentence, straight to the point, understandable on its own** (`edit-note.sh`), delete
the noise (`del-note.sh`), fold near-duplicates into one. Never collapse the timeline
into a single bulleted note: it loses the order and the dates. A kept note reads like:

- `Fixed the double import with a check on existing codes (web#123)`
- `Made the importer accept semicolon-separated CSV files (api#126)`
- `Released to production with v1.7.1`
- `Asked Jane for the corrected file`

The issue/PR link goes **at the end, as an extra** for whoever wants detail — never
the substance. Aim for ~6 notes per task (fold minor steps). No run ids, digests,
changeset names, log lines, semicolon chains, or notes that only make sense by opening
the link. No dates in the text: each note carries its own timestamp. Write in short, plain words, in the user's language,
one idea per line, no jargon unless it is the name of the thing.

Titles: short, `Area/Customer: topic` or the bare topic, ~5 words
(`Acme: import stuck`, `CI speed`).

Steps: ≤4, imperative, one line each, only what is really left.

## 4. Resume a theme

When the user wants to pick a theme up (or hand it to another agent), produce the
`delegate-prompt` block, save it to a file **and** as a text note on
the task (scratch folders are temporary; the note survives). Mark STOP points for
anything touching production, customers or shared infra.

## API cheat-sheet

- `PATCH /api/tasks/:id` — `title`, `summary`, `due_at` (ISO or `""`), `status`
  (`pending|in_progress|done|snoozed|shelved`)
- `POST /api/tasks/:id/done`
- `POST /api/tasks/:id/notes` `{body, kind}` · `PATCH|DELETE /api/tasks/:id/notes/:noteId`
- `POST /api/ingest/steps` `{match: <id>, steps: [...]}` — full replace
- Build JSON bodies in Python/`jq -n`, not by echoing task JSON through the shell:
  control characters in note bodies break `echo | jq`.

## Close

Report: open count before → after, zero overdue, what was closed publicly (links),
urgent items still open, and where the resume prompts are.
