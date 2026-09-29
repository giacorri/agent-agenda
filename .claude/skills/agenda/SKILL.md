---
name: agenda
description: |
  Read and maintain the connected agent-agenda as shared work/personal memory.
  Use when the user says "/agenda", "agenda", "resume from the agenda", "what's
  left to do", "continue the task", "it was tracked in the agenda" (or the same
  request in any language, e.g. "riprendi dall'agenda"), asks for
  current tracked work, or when a task already has agenda state that must be preserved.
  This skill orients Claude on what agent-agenda is, how to consult it, when to
  use the companion skills (`add-to-agenda`, `note-progress`, `set-next-steps`,
  `handoff-recap`, `delegate-prompt`), and how to avoid duplicate tasks.
---

# agenda — read and maintain agent-agenda

`agent-agenda` is the shared memory between the user and agents. It tracks both
work and personal tasks through the same API. A task has three separate planes:

- **notes** = past: what already happened.
- **steps** = future: what is still planned.
- **closing** = handoff: what to tell whoever asked, once the topic is closed —
  what works now, what they still have to do, what is left open.

Do not treat the agenda as generic memory. Use it for actionable tracked work,
reminders, blockers, handoffs and follow-ups.

## Keep it simple

Everything you write into the agenda — titles, summaries, notes, steps, closing
messages, and any issue or PR text that comes out of the work — is read by a busy
human. So:

- **Short, plain words, in the user's language.** Everyday words; no jargon unless it is the name of the thing.
- **One idea per line.** Split a long sentence instead of chaining clauses.
- **Say the effect, not the process.** What changed or what is left, not how you got there.

## First move

Check the backend and config before assuming categories, people or scopes:

```bash
: "${AGENDA_URL:=http://localhost:4010}"
config-status.sh
curl -s "$AGENDA_URL/api/config" | jq '{categories: [.categories[].key], people: [.people[].key], scopes: [.scopes[].key], refs: [.refs[].key]}'
```

If `config-status.sh` says unconfigured, do not invent categories or people. Tell
the user setup is needed before reliable agenda writes.

## Read current state

For broad orientation:

```bash
list-tasks.sh
```

For a specific task, prefer the stable id. If the user gives only a topic, search
with `list-tasks.sh` first, then read the best match:

```bash
show-task.sh "<task-id-or-specific-match>"
```

When reporting back, keep it short:

- current task/title and id;
- latest note or blocker;
- remaining steps;
- whether it is personal/work scope if visible in the task data;
- concrete next action.

When you mention a task in the reply, write it as a markdown link —
`[title](<AGENDA_UI_URL>/task/<id>)` — which opens the agenda with that task's
drawer already open. `$AGENDA_UI_URL` is the web app (default
`http://localhost:4011`), not `$AGENDA_URL`, which is the API.
`list-tasks.sh` and `show-task.sh` print the link next to each task.

## Preserve tracked state

If the work is already tracked in agenda:

- Do **not** create a duplicate task.
- Continue using the same task id for notes, steps, closing and done.
- When a step is completed, add one note with `note-progress`, then rewrite the
  remaining plan with `set-next-steps`.
- When the plan changes, rewrite all remaining steps with `set-next-steps`; it is
  a full replace.
- As soon as the topic is **de-facto closed** — our part done, what remains is on
  someone else (a decision, an operation on their database or configuration, just
  telling them) — write the closing with `handoff-recap`, do not wait for `done`.
  A plan down to "tell X" is that case: closing written, zero steps left. Mark the
  task done with `done-task.sh` when it is actually over.

If there is no tracked task and the user wants a future action/reminder, use
`add-to-agenda`.

## Companion skills

- Use `add-to-agenda` to create a new future task/reminder/follow-up.
- Use `note-progress` to append one past event to an existing task.
- Use `set-next-steps` to replace the forward plan of an existing task.
- Use `handoff-recap` to produce and save the closing message of a closed topic.
- Use `delegate-prompt` to create a copy-paste prompt from an agenda task.
- Use `tidy-agenda` to clean up: verify what is done, close it, condense notes, merge duplicates.

Use the companion skill names explicitly in agenda notes when the local convention
asks for a `[skill: ...]` suffix.

**Note kinds `file`/`link`**: the body must be ONLY the path or URL — the UI wraps
the whole body in a single `<a href="file://…">` / `<a href>`. Prose in a `file`/`link`
note becomes one broken link. Put descriptions in a separate `text` note (those render
markdown, and `[label](file:///abs/path)` links work there). To clip an existing
`file`-note misused as prose: `DELETE /api/tasks/:id/notes/:noteId` then re-add
(kind is not PATCH-able, only the body is).

## Work vs personal

Work and personal are runtime scopes, not hardcoded assumptions. Read
`/api/config` to discover the actual scope keys and hidden/personal behavior.
When a task is personal, preserve that scope on future updates. Do not move a
task between work and personal unless the user asks.

## Start/resume convention

When the user asks to resume from agenda, read the task before doing new work.
The safe sequence is:

1. `config-status.sh`
2. `list-tasks.sh` or filtered search
3. `show-task.sh <id>`
4. Summarize past notes and remaining steps
5. Continue the work and write milestones back as they happen

The agenda is the source of truth for tracked state; chat history is secondary.
