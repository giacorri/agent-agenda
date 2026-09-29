---
name: add-to-agenda
description: |
  Capture a task / reminder / follow-up into the connected agent-agenda. Use when
  the user says "remember this", "put it on my agenda", "remind me to...", "track
  this", "save this task", or when you finish a piece of work and an actionable
  follow-up with a concrete date remains. This is NOT a generic memory/notes store:
  if there is nothing to DO in the future, do not propose the agenda. If an open
  task on the same topic already exists, append a note to it (skill `note-progress`)
  instead of creating a duplicate.
---

# add-to-agenda — capture a task into agent-agenda

`agent-agenda` is a small local web app that tracks tasks, each with an optional
due date plus a timeline of notes. This skill creates a task in it via the `add-task.sh` helper,
which posts to `POST /api/ingest`.

## When to use

1. **New reminder** — the user explicitly asks to remember something for later
   ("remind me tomorrow", "put it on the agenda", "memo", or equivalents).
2. **Dated follow-up** — you are finishing a piece of work and an *actionable*
   follow-up with a concrete trigger remains ("when access is granted", "Monday
   after the deploy", "in 2 hours when the job ends").
3. **Blocking link** — a task can't start until another one finishes ("after the
   migration lands", "once the PR is merged"). Create it with `--blocked-by
   "<keyword>"` so it waits on the prerequisite (see Options below).

## When NOT to use

The agenda is not a memory/context/notes store. Do not create a task when the
content is only a decision already made, an architecture note, a snippet to
remember "in general", a session summary, or a bookmark with nothing to do on it.
Quick test: no **action to do** + no **date or trigger condition** → not agenda
material. If an open task on the same topic exists, add a note to it with
`note-progress`, do not duplicate.

## The three planes of a task

A task has three distinct zones — keep them separate:

- **description** (`--summary` + `--body`): what the task is and why it matters. Stable.
- **next steps** (`--step`, repeatable): the ordered forward plan. Update later with `set-next-steps`.
- **notes** (timeline): the backward "what happened" log. Add with `note-progress`.

## Read config first (config-driven, never hardcode)

Categories, people (requesters), clients, ref shorthands and scopes are runtime config.
Read them so you use real values, not invented ones:

```bash
: "${AGENDA_URL:=http://localhost:4010}"
curl -s "$AGENDA_URL/api/config" | jq '{categories: [.categories[].key], people: [.people[].key], clients: [.clients[].key], scopes: [.scopes[].key]}'
```

`--service` must be a configured category key, `--requester` a configured person
key (or any free-form name). If config is empty it is a fresh install — pass plain
free-form tags and skip `--service`/`--requester`.

**A requester who is not in the roster must be added to it.** The sidebar builds its
requesters list from `config.people` only, so a task whose `requester` matches no
configured person is invisible there — no row, no counter, no per-person page in the
navigation. Before creating the task, check the roster; if the person is missing, add
them, then use their `key`:

```bash
curl -s -X POST "$AGENDA_URL/api/config/people" -H 'Content-Type: application/json' \
  -d '{"key":"jane","label":"Jane Doe","role":"","sort":0}'
```

The `key` is matched case-insensitively as a **substring** of the task's `requester`
string, so a first name (`jane` ⊂ `Jane Doe`) is enough — but pick one that
can't collide with another person's full name. `label` is the display name, `role` a
free-form one-word note (`delivery`, `boss`, `peer`, …) — leave it empty when you don't
know it, don't guess. `photo` is optional (a `data:` URI); the avatar falls back to
initials without one.

**A client works exactly the same way**, on its own roster (`config.clients`): the
sidebar lists only configured clients, so add the missing one before using it.

```bash
curl -s -X POST "$AGENDA_URL/api/config/clients" -H 'Content-Type: application/json' \
  -d '{"key":"acme","label":"Acme","sort":0}'
```

`logo` is optional (a path/URL or a small `data:` URI); without one the row falls back
to a neutral building glyph.

**Bare refs from the task's repo.** Tag or scope a task with a configured ref
shorthand (e.g. `--tag web`, with a `web → acme/web-app` mapping) and
its summary/notes/steps can use unqualified `#413` (issue) / `PR#413` (pull) — they
auto-link to that repo. Qualify (`other#413`) only to point at a different repo. Works
when exactly one of the task's tags/scopes maps to a repo, so a bare `#N` is never
ambiguous.

## Field rules (what makes a good card)

**Register — managerial, not a log.** Every field reads like a manager glancing at a
board, not an engineer's record: short and plain by default, longer only for a
genuinely delicate or broad task. Name the thing once; don't explain it in full.

**Voice — short, plain words, in the user's language.** One idea per line, everyday words. Keep a
technical term only when it is the name of the thing (`PWA`, `CI`, `webhook`,
`cache`), never jargon for its own sake. Pick the **plain everyday word**, not a stiff
or elaborate variant — the word someone would actually say. Applies to every field
below, to notes, and to any issue or PR text you write for the task.

- **title** — the TOPIC, 2-5 words, no leading verb. Just the subject, not the
  action (the action lives in the steps), and never *who* or *how* it gets done —
  no process/agent meta ("with a new agent", "handoff to…", "re-run"). Plain
  language, no jargon; a bare identifier or code (an ADR number, a ticket id) is
  not a topic — the real subject goes in the title, the identifier in
  `--service`/`--tag`. The test: does it explain itself on first read to someone
  who does not follow the work? Good: "Excel import performance". Bad: "Fix the
  slow Excel import" (leading verb + action); "Resume ADR-006 with a new agent"
  (opaque id + process meta — says nothing).
- **summary** — the PROBLEM in **2-3 sentences**: what + why it matters, NOT the
  actions to take (those are the steps). Short prose is the default. It is the only
  description field, so a genuinely *umbrella* task (one spanning many repos/areas)
  may lay out the **problems/areas as bullets** — describe each in plain words, each
  led by a **bold** key term; don't reduce the summary to a list of issue numbers
  (refs support the text, they don't replace it). Use a **single** list — don't split
  into overlapping ones (a "general problems" list plus an "urgent" list just doubles
  the length and reads badly); fold each urgent item's ref into its problem bullet.
  Keep it to the few that matter and push the long ref list to a linked doc. Reach for bullets only when a real list is unavoidable, never a prose blob that
  buries a list inside a sentence. May end with a ref shorthand if configured. A
  grouped catalog is description → summary; a thing-that-happened is a note.
- **body** — optional sugar that does NOT set a description field: it creates the
  task's **first timeline note** (`ingest.ts` turns `body` into a note). So use it
  only for a genuine opening "what happened" note, under the note rules
  (`note-progress`) — never to park the stable catalog. That belongs in `--summary`.
- **service** — a configured category key, repeated for cross-cutting tasks. Do
  NOT put a category inside `--tag`.
- **tag** — free-form area/context labels (e.g. `security`, `ops`, `review`,
  `deploy`). Not category names.
- **requester** — who asked for the task. Omit when it is your own idea
  (self-assigned). Must exist in `config.people` — add them first if not (see above).
  When set, `handoff-recap` produces the closing message for them.
- **client** — the client/company the work is for (`--client`). Work only: omit it on
  personal tasks and on internal work with no customer. Must exist in
  `config.clients` — add it first if not (see above).
- **step** — one forward-plan next step, repeatable, ordered. Goes in the
  dedicated steps field, not the body or notes.
- **when** — natural date ("tomorrow", "in 2 hours", "Friday at 14:00") or an
  explicit `YYYY-MM-DD HH:MM`. **Optional — only when the user gave a date or a real
  trigger.** No date from the user → omit `--when`: the task is created with no due
  date and no reminder, which is a valid task. NEVER invent a date or a time to fill
  the field ("tomorrow 18:00" because "it seemed reasonable" is wrong). If the user
  gave a day but no time, pass the day only ("tomorrow", "Friday"): the app applies
  its configured `default_remind_time`, don't pick an hour yourself.
- **blocked-by / blocks** — blocking links, matched by keyword against an existing
  OPEN task (title/tag/service, or a task id). `--blocked-by "<keyword>"`: the new
  task waits on that prerequisite — it stays visible with a lock badge but fires NO
  reminders until the prerequisite is `done` or `shelved`, then reactivates on its own.
  `--blocks "<keyword>"`: makes the matched task wait on this new one. Unmatched
  keyword → the link is skipped and the task is still created. To link two tasks
  that BOTH already exist, POST `{"blocked":"<kw>","blocked_by":"<kw>"}` to
  `$AGENDA_URL/api/ingest/link`.

## Command

```bash
add-task.sh \
  --title   "Excel import performance" \
  --summary "Old import loaded the whole file into memory and ran out of heap on big files. New streaming reader keeps memory flat. Ref: repo#88." \
  --when    "in 3 days" \
  --service backend --service worker \
  --tag     performance --tag review \
  --step    "Measure and document the gain" \
  --step    "Fix the broken rollback path" \
  --requester alex \
  --body    "Roll-out in two phases. See repo#88 (closed) for the blueprint."
```

`--when` is there because the user said "in 3 days"; with no date from the user the
line is simply left out. Options: `--remind-min N` (remind N minutes before due), `--personal` — put the task in
the configured **personal** scope (`personal:true`); it is a real scope, not a hidden one.
Repeat `--service`, `--tag`, `--step` as needed.

**Scope rule.** The default scope is `work`. If you keep side projects in the personal scope,
pass `--personal` (or `personal:true` in a raw `/api/ingest` POST) for their tasks; everything
else stays `work`.

If `add-task.sh` is not on PATH, call it by its full path in the agenda repo's
`scripts/` dir, or post directly to `$AGENDA_URL/api/ingest` (default
`http://localhost:4010`).

## After running

Read the output (a JSON task with its `id` and `due_at`), THEN reply — do not
confirm before the command actually ran. Tell the user what was saved: "Saved for
<day> <time>, services <…>, tags <…>."

When you mention a task in the reply, write it as a markdown link —
`[title](<AGENDA_UI_URL>/task/<id>)` — which opens the agenda with that task's
drawer already open. `$AGENDA_UI_URL` is the web app (default
`http://localhost:4011`), not `$AGENDA_URL`, which is the API.
`add-task.sh` prints the link on stderr right after the create.
