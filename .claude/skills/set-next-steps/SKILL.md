---
name: set-next-steps
description: |
  Rewrite the "next steps" (the forward plan) of a task in the connected
  agent-agenda. These are the ordered boxes that look forward, distinct from notes
  (the backward timeline). Use when the plan changes: a step is done, a new one
  emerges, the order shifts. ALWAYS replaces the whole list, so pass every step you
  want to keep, in order. To log a step already done use `note-progress` instead;
  to hand the outcome to whoever asked, use `handoff-recap` — a message to send is
  never a step.
  Fast skill: produce the steps, run the command, done.
---

# set-next-steps — rewrite the forward plan

**Register — managerial, not a log.** Each step is a line on a board a manager can
act on at a glance: short, plain words, in the user's language, one action per line. No story, no jargon
unless it is the name of the thing.

A task has three planes: description (what it is), **next steps** (the forward
plan, ordered), and notes (the backward timeline). This skill rewrites the next
steps via `set-steps.sh`, which posts to `POST /api/ingest/steps`.

This is a **full replace**, not an append: pass every step you want to keep, in
execution order. When a step is done, drop it from here AND log it as a note with
`note-progress` — so the steps stay the live plan and the notes stay the history.

## Command

```bash
set-steps.sh "<match>" \
  --step "Verify whether the regression (`abc1234`) was intentional or an incident" \
  --step "Dry-run \"before\" on the read-only env to confirm the empty field" \
  --step "Decide: merge web#413 or leave it"
```

Empty the plan: `set-steps.sh "<match>" --clear`.

`<match>` is a task id, or a substring of the title / tag / service of a pending
task (earliest due date wins).

## Rules (few)

- **One step = one concrete thing to DO** (an action), in real execution order.
  Keep it to **one short line** — verb + object: "Merge repo#PR101", "Check
  `app.stats` on staging". The how, the why and piles of refs go in a note, never
  crammed into the step with parentheticals.
- **Actions only — not states.** A step is something to do next, not a status. Keep
  OUT of the steps: things you are waiting on, open decisions, deferred/parked ideas,
  and bare lists of issue numbers. An open decision or a blocker belongs in a note
  (`note-progress`) with a headline that flags it; a parked idea is a note too. The
  steps column must stay a clean, doable plan — not a mixed drawer.
- **No date, no story**: steps look forward. The "how it went" goes in notes.
- **A message to someone is never a step.** A step like "tell <person> that X, and
  ask them Y" means the closing message is missing: its content belongs in the task's
  `closing` field — write it with `handoff-recap` — and the plan keeps at most the
  bare action ("send <person> the closing message"), never the text. Same when the plan is
  down to communication only: that is a de-facto closed topic, so the right move is to
  write the closing and leave **zero steps**, not to park the message here.
- Markdown ok: **bold** on the core of the step, `code` for technical names, refs as
  bare text so they auto-link: unqualified (`#413` / `PR#413`) when the task's repo is
  obvious, qualified (`other#413`) only to point at a different repo.
- **When a step is done: remove it here** (rewrite the list without it) **and log a
  note** with `note-progress`.
- Keep the list short (3-6 steps). If it grows into an epic, that is a sign you
  need more than one task.

## Citing the task in your reply

When you mention a task in the reply, write it as a markdown link —
`[title](<AGENDA_UI_URL>/task/<id>)` — which opens the agenda with that task's
drawer already open. `$AGENDA_UI_URL` is the web app (default
`http://localhost:4011`), not `$AGENDA_URL`, which is the API.
`set-steps.sh` does not print it: build the URL from the id of the
task you matched.

If `set-steps.sh` is not on PATH, call it by full path from the agenda repo's
`scripts/` dir, or post directly to `$AGENDA_URL/api/ingest/steps` (default
`http://localhost:4010`).
