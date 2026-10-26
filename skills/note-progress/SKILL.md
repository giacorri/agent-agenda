---
name: note-progress
description: |
  Append ONE timeline note (what happened) to a task in the connected agent-agenda,
  the same turn a milestone happens: a decision made, a blocker hit or cleared, a PR
  opened or merged, an issue closed, a step done, a deploy. Forward plan:
  set-next-steps. New task: add-to-agenda.
---

# note-progress — append one timeline note

**A note is one short sentence saying what got done.** Like a line in a diary
someone skims in five seconds: the outcome, in plain words, in the user's language.
Aim for **at most ~20 words**. If you need more, you are either writing several facts
(→ several notes) or explaining details that belong somewhere else.

A task's notes are its timeline: read in order, they tell the story of the task
without opening any PR, issue or chat. The card shows the **last note** as the
current state at a glance.

This skill appends one note via `add-note.sh`, which posts to `POST /api/ingest/note`.

## When to use (one milestone = one note, same turn)

Log a note immediately when one of these touches a tracked task:

- a PR opened or merged that belongs to the task;
- an issue closed that was in the plan;
- a decision made (a choice between alternatives, a spec written);
- a blocker hit, moved, or cleared;
- a deploy / cutover step completed;
- a step from the plan done;
- a material follow-up acquired ("owner found", "date fixed").

Do it the same turn the milestone happens — not at end of task, not at end of
session. Do NOT create a duplicate task; if the topic is already on the agenda,
note it.

A milestone means the task is being worked: if it is still `pending`, also run
`set-status.sh <id> in_progress` (leave `done`, `snoozed` and `shelved` alone).

## The golden rule: each note stands ALONE

Before writing, test: *if someone reads only this note — no chat, no other notes,
without opening the PR/issue — do they understand what happened?* To pass, the
note must NAME the thing, not point at it:

- Bad: "PR opened" → which PR? doing what? where?
- Good: "Opened repo#400: fixes the cross-build that blocked the deploy. In review."
- Bad: "Merged" → what?
- Good: "Merged repo#259 (squash): aligned the cleanup callers. Only repo#200 left."

The first time a PR/issue/file appears, say what it is (half a line). Later notes
can refer to it by number.

## Note shape: one line

**One note = one thing done = one sentence.** Several things happened → several
notes, one `add-note.sh` call each. Never a list, never a paragraph.

- Bad: "Registry token `acme-pull` created (scope map `acme-read`, read-only on the 15
  installer images). Password in the vault. The CLI printed it in a warning in the
  terminal: stays local, no issue."
- Good: "Created the registry token for the customer install; password in the vault."

- Bad: "Re-checked the machine: database reachable (port 1436), internal DNS ok,
  certificate `site.pfx` in `/home/svc/certs` (local user's home), Docker empty."
- Good: "Checked the machine: database, DNS and certificate are ready."

What the second half of each bad note carries — paths, ports, account and vault
names, why the CLI behaved as it did — is detail. It belongs in the task description,
the repo docs or the vault item, not in the timeline. Leave it out.

Only a decision or a blocker may take a second line, for the *why* in a few words:

```bash
add-note.sh "<match>" --body "Chose the nightly export over the live sync: the API has no paging."
```

`<match>` is a task id, or a substring of the title / tag / service of a pending
task (earliest due date wins). If nothing matches, the command exits non-zero — then
create a task with `add-to-agenda`.

## Text rules (few, not optional)

- **Outcome, not process.** "The importer now accepts semicolon CSV files", not which
  commands ran, which gate passed or which agent did it.
- **No dates in the text.** The timeline shows each note's time; "26/10 —" or
  "today" duplicates it.
- **No ids, paths, ports, hashes or log lines** unless the thing has no other name.
- **At most one reference, at the end** (`repo#PR98`), as an extra for whoever wants
  the detail. Refs are unqualified when the task's tag names the repo (`#413`,
  `PR#413`), never in backticks: only bare text auto-links.
- **Bold at most one key term**, and only when it helps the eye; no emoji.
- **Self-contained:** name the thing ("the registry token"), never "it" or "the PR".
- **Plan stays out:** what is left to do lives in the steps (`set-next-steps`).

## Citing the task in your reply

Mention a task in the reply as `[title](<AGENDA_UI_URL>/task/<id>)`: it opens the
agenda on that task. `$AGENDA_UI_URL` is the web app (default `http://localhost:4011`),
not the API.
`add-note.sh` does not print it: build the URL from the id of the
task you matched.

The helpers come with the plugin and are on PATH while it is enabled. Without it, run
them from the agenda repo's `scripts/`, or post to `$AGENDA_URL/api/ingest/note` (default
`http://localhost:4010`).
