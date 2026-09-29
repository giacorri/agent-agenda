---
name: note-progress
description: |
  Append ONE timeline note to a tracked task in the connected agent-agenda — the
  backward "what happened" log. Use when a meaningful milestone happens on a topic
  already tracked: a decision made, a blocker hit or cleared, a PR opened or merged,
  an issue closed, a step done, a deploy completed. One note = one milestone, logged
  the SAME turn it happens. For the forward plan use `set-next-steps`; to create a
  new task use `add-to-agenda`. Fast skill: write the text, run the command, done.
---

# note-progress — append one timeline note

**Register — managerial, not a log.** Write each note like a manager glancing at a
board, not an engineer keeping a record: concise by default, longer only when the
topic is genuinely delicate. Name the thing once — don't explain it in full.

**Short, plain words, in the user's language, one idea per line.** No jargon unless it is the name of the
thing. **Short sentences, straight to the point.** Each fact is one short past-tense sentence
that stands on its own — "Fixed the double import with a check on existing codes",
"Made the importer accept semicolon-separated CSV files". The issue/PR link sits at the end as an
extra for whoever wants the detail, never as the substance. No run ids, digests,
changeset names, log lines or chains of clauses: if the reader needs the link to
understand the sentence, rewrite the sentence.

A task's notes are its timeline: read in order, they reconstruct the whole story
without opening any PR, issue or chat. The card shows the **last note** as the
current state at a glance — so each note must be self-contained and the sequence
must form a complete timeline.

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

## Note shape: keep it scannable

Usually two parts: a **headline** (first line, rendered bold) then, after a blank line,
a short **story** (1-2 lines: what changed, plus the single open point if any). The
headline carries the OUTCOME or lesson, not the topic.

The headline is **optional**: a small, purely operative note reads better as one plain
line, no bold title — e.g. "Runner cleanup fix ready to merge —
`web#448`". And when a note makes **several distinct points, write them as bullets**,
never a prose blob that hides them in a sentence. Concise but complete: bullets let you
stay short and still keep the real finding — don't strip a note down until it says little.

```bash
add-note.sh "<match>" --body "$(cat <<'EOF'
<Headline: 3-8 words, carries the outcome/lesson of the step>

<Story: what changed, plus the one open point if any. 1-2 lines.>
EOF
)"
```

`<match>` is a task id, or a substring of the title / tag / service of a pending
task (earliest due date wins). If nothing matches, the command exits non-zero — then
create a task with `add-to-agenda`.

## Text rules (few, not optional)

- **One PR / feature = one note.** Never cram several PRs into one note; the
  timeline wants them separate, each with its own timestamp. Do not put the forward
  plan here — that lives in the steps field (`set-next-steps`).
- **Substance, not codes.** Say what actually changed for the app / the user, in
  plain words — not just the number plus a technical or process label. `repo#98
  merged, 54 files` says nothing; "Track analysis got faster — X is precomputed now"
  is the substance. Drop internal process jargon (build-gate names, agent/pipeline
  labels): the reader cares what the app does now, not how you got there.
- **No emoji, ever.** The step's category (done · blocked/waiting · open decision ·
  new fact that changes the plan) comes from the words of the headline, not an icon.
- **Bullets when you enumerate.** If the note makes 3+ distinct points, write them as a
  bulleted list — never a prose blob that buries them in a sentence. One point → one
  plain line is fine. Visual impact over prose walls.
- **Few refs in the text — one link at the end, at most.** Tell the story in plain
  words; park the reference (`repo#PR98`) at the tail, don't sprinkle numbers through
  the sentence.
- **Bold the key terms, generously.** Lead each bullet / point with its key term in
  **bold** (the outcome, the number that matters, the cause) so the eye lands on the
  substance at a glance. Use `code` for every technical name: files, classes,
  branches, CI checks, commands, columns, error strings.
- **NO date in the text**: the frontend already shows the timestamp from
  `created_at`; writing it makes it appear twice. No "today/yesterday".
- **Refs unqualified when the repo is obvious.** In a task whose tag or scope names a
  configured repo, write just `#413` (issue) / `PR#413` (pull) — they link to that
  repo. Qualify (`other#413`) only to point at a *different* repo. Never in backticks
  — only bare text auto-links; the `PR` marker routes to `/pull/`. A plain **repo
  name** (e.g. `acme.web.app`, written bare) auto-links to the repo itself, no `#N`.
- **Self-contained**: always name the thing (which PR/issue/file), never "the PR".

## Example

```bash
add-note.sh "import" --body "$(cat <<'EOF'
Streaming import landed — big files no longer run out of memory.

Switched the Excel reader from loading the whole file at once to reading it row by row, so memory stays flat whatever the file size. Green on all checks. repo#PR406
EOF
)"
```

The headline carries the outcome in plain words (not "merged repo#406"), the story
says what changed for the user, and the single ref sits at the end as a `PR` link.

## Citing the task in your reply

When you mention a task in the reply, write it as a markdown link —
`[title](<AGENDA_UI_URL>/task/<id>)` — which opens the agenda with that task's
drawer already open. `$AGENDA_UI_URL` is the web app (default
`http://localhost:4011`), not `$AGENDA_URL`, which is the API.
`add-note.sh` does not print it: build the URL from the id of the
task you matched.

If the agenda scripts are not on PATH, call them by full path from the agenda
repo's `scripts/` dir, or post directly to `$AGENDA_URL/api/ingest/note` (default
`http://localhost:4010`).
