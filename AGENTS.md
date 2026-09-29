# AGENTS.md

How any coding agent drives a connected **agent-agenda** instance.

`AGENTS.md` is a cross-tool convention: a plain-Markdown file at the repo root that
agents read to learn how to work in a project. This one is the canonical operating
guide for an agent (Claude Code, or any assistant that can run `curl`) that has been
pointed at a live agent-agenda backend. If your tool uses `CLAUDE.md`, it can simply
reference this file:

```md
See AGENTS.md for how to drive the connected agent-agenda instance.
```

For the precise list of every endpoint and payload, see
[docs/agent-api.md](docs/agent-api.md). For first-run configuration of an empty
install, see [docs/setup-with-an-agent.md](docs/setup-with-an-agent.md); for every
option you can customize, see [docs/configuration.md](docs/configuration.md).

## What it is

agent-agenda is a **shared human↔agent agenda**. A person and one or more agents write
to the same task list over a small HTTP API. The person sees a live web app (timeline,
week, month) with due reminders; the agent reads and writes the same tasks to record
what it is doing, plan what comes next, and hand work back. It is the durable memory
that survives across agent sessions: when a new session starts, it re-grounds by
finding the existing task and reading it back, instead of relying on chat history.

The instance ships **completely empty** — categories, people, clients, reference links
and scopes are all runtime config, never hardcoded. Read them from `/api/config` at the
start of a session; do not assume any specific value exists.

## Pointing at the instance

- **API base:** the `$AGENDA_URL` environment variable. The bundled scripts default to
  `http://localhost:4010` when it is unset. A Docker install listens on `4010`; a
  backend run directly (no Docker) listens on `4000` — set `$AGENDA_URL` accordingly.
- **Web app base:** the `$AGENDA_UI_URL` environment variable (default
  `http://localhost:4011`). `<AGENDA_UI_URL>/task/<id>` is a task's deep link: the agenda
  with that task's drawer already open. `add-task.sh`, `show-task.sh` and `list-tasks.sh`
  print it — mention a task to the person as that link.
- **Scripts on PATH:** the helpers in [`scripts/`](scripts/) wrap the common calls
  (`add-task.sh`, `add-note.sh`, `set-steps.sh`, `set-closing.sh`, `set-personal.sh`,
  `list-tasks.sh`, `show-task.sh`, `done-task.sh`, `snooze-task.sh`, `set-title.sh`,
  `set-settings.sh`, …). Each reads `$AGENDA_URL`, builds the JSON for you, and fails non-zero on error.
- **Liveness:** check the backend is reachable and whether it is configured yet with
  `GET /api/config/status` (or `config-status.sh`). It returns
  `{ "configured": bool, "counts": { … } }`. `configured:false` means a fresh,
  unconfigured install — set it up first (see the setup guide) before creating tasks.

## Task vocabulary

A task is the unit of shared state. Its fields, and how an agent should use them:

| Field        | What it is | Agent guidance |
| ------------ | ---------- | -------------- |
| `title`      | Short headline (3–6 words). | Plain, active voice. No technical component names. Shown on the card. |
| `summary`    | One or two lines: what + why it matters. | Plain language, scannable at a glance. Shown on the card. |
| `services`   | The **configured category keys** this task touches. | Use keys from `/api/config` (`kind` `service` or `app`). **NOT tags** — categories are a separate, configured list. Repeat for multi-category tasks. |
| `tags`       | Free-form area/context labels. | e.g. `security`, `ops`, `review`, `deploy`. Free text, not the category list. Do not put category keys here; a tag equal to a configured client key is moved to `client` on create. |
| `steps`      | **Forward plan**: ordered short "next steps". | The right-hand column. What is *still to do*, in order. Replace the whole list when the plan changes. A completed step is removed and logged as a note. |
| `notes`      | **Backward timeline**: progress notes. | What *already happened*, newest at the tip. One note = one step done / decision / blocker. Append-only from the agent's side. |
| `closing`    | Handoff message for whoever the work is reported to. | The wrap-up text: what now works, what they still have to do, what is left open. Write it as soon as the topic is de-facto closed, not only at `done`. Markdown. |
| `requester`  | Who asked for the task. | Free text; matching a configured person drives the closing register. Omit if self-assigned. |
| `client`     | The client/company the work is for. | Free text; matching a configured client gives it a sidebar row and a `/client` page. **Work only** — omit on personal tasks and on internal work with no customer. |
| `priority`   | Integer (lower = more important; default `2`). | Set only when it matters. |
| `status`     | `pending`, `in_progress`, `done`, `snoozed` or `shelved`. | Mark done with `done-task.sh`. `shelved` = dropped on purpose but kept for the record (set it from the UI or `PATCH`). Overdue is computed, not a status. |
| `when`       | **Natural-language** due time. | e.g. `"tomorrow"`, `"in 1 minute"`, `"friday 10am"`. Parsed server-side at create time. **Optional**: omit it for a "general" task with no deadline — it fires no reminders and lists in the General group, ordered by insertion date. Use a `when` only when the task truly has a deadline. |

Mental model: **notes = the past, steps = the future, closing = the handoff.**

## Capability table (intent → script → endpoint)

| Intent | Script | Endpoint |
| ------ | ------ | -------- |
| Create a task | `add-task.sh` | `POST /api/ingest` |
| Create a task blocked by / blocking another | `add-task.sh --blocked-by` / `--blocks` | `POST /api/ingest` |
| Link two existing tasks | — | `POST /api/ingest/link` |
| Add a timeline note (progress) | `add-note.sh` | `POST /api/ingest/note` |
| Attach a local file as a note | `attach-file.sh` | `POST /api/ingest/note` |
| Fix or remove a note | `edit-note.sh` / `del-note.sh` | `PATCH` / `DELETE /api/tasks/:id/notes/:noteId` |
| Replace the forward plan (next steps) | `set-steps.sh` | `POST /api/ingest/steps` |
| Write the closing / handoff message | `set-closing.sh` | `POST /api/ingest/closing` |
| Toggle a task personal | `set-personal.sh` | `POST /api/ingest/personal` |
| List / filter tasks | `list-tasks.sh` | `GET /api/tasks?status&from&to&tag&service` |
| "Check my agenda": open work, overdue first | `agenda-check.sh` | `GET /api/tasks` |
| Read one task + its notes | `show-task.sh` | `GET /api/tasks/:id` |
| Mark a task done | `done-task.sh` | `POST /api/tasks/:id/done` |
| Snooze a reminder | `snooze-task.sh` | `POST /api/tasks/:id/snooze` |
| Rename a task (fix the title) | `set-title.sh` | `PATCH /api/tasks/:id` |
| Edit any other task field | — | `PATCH /api/tasks/:id` |
| Liveness / first-run check | `config-status.sh` | `GET /api/config/status` |
| Read config (categories/people/clients/refs/scopes) | — | `GET /api/config` |
| Configure an empty install | `bootstrap-config.sh` | `POST /api/config/bootstrap` |
| Add or change one config row | `set-category.sh`, `set-person.sh`, `set-ref.sh`, `set-scope.sh` | `POST /api/config/{entity}` |
| Change app settings | `set-settings.sh` | `GET` / `PATCH /api/config/settings` |

Endpoints that act on an existing task take a **`match`**: a task **id**, a substring
of the title, or an exact tag / category key. For notes, steps and links it resolves
against **open** tasks (pending, in_progress, snoozed) and picks the one due soonest;
for closing and personal it searches **any** status (a closing is usually written on a
task already marked done) and picks the newest. When in doubt, match by **id**.

## Blocking links (dependencies)

A task can depend on one or more **prerequisites**. While any prerequisite is still
open (not `done` or `shelved`), the dependent task is **blocked**: it stays visible (with a lock badge) but
fires **no reminders**, and reactivates on its own the moment its last prerequisite
is closed. `blocked` is derived from the links, never a stored status; the stored
statuses (`pending`/`in_progress`/`done`/`snoozed`/`shelved`) are unchanged.

- **At create time:** `add-task.sh --blocked-by "<keyword>"` makes the new task wait
  on an existing OPEN task; `--blocks "<keyword>"` makes an existing task wait on the
  new one. The keyword matches a title / tag / service (or an id); an unmatched
  keyword skips the link and still creates the task.
- **Between two existing tasks:** `POST /api/ingest/link` with
  `{ "blocked": "<match>", "blocked_by": "<match>" }` — `blocked` depends on
  `blocked_by`. `404` if either match fails, `409` on a duplicate or a cycle.
- **From the REST side:** `POST /api/tasks/:id/deps { "depends_on": "<id>" }` and
  `DELETE /api/tasks/:id/deps/:depId` (the web UI uses these). A task's open
  prerequisites are surfaced as `blocked_by` on the feed and single GET; its
  dependents as `blocks` on the single GET.

Cycles are rejected. Use dependencies when a task genuinely **cannot start** until
another finishes — not to express mere ordering preference.

## Decision rules — which write to make

- **Create a task** (`add-task.sh`) when there is a *new* actionable item. Give it a
  `--when` only if it has a real deadline. First check whether one already exists
  (`list-tasks.sh` / match) — if so, do **not** create a duplicate; add a note to the existing task.
- **Add a note** (`add-note.sh`) when something *happened* on a tracked task: a step
  finished, a decision was made, a blocker appeared or cleared, a PR opened, a deploy
  ran. One note per event. The timeline is the record of the past.
- **Update steps** (`set-steps.sh`) when the *plan ahead* changed: a step is done, a
  new one emerged, the order shifted. This **replaces the whole list** — pass every
  step you still want to keep, in order. (To log a step you just finished, write a
  note; don't only delete it from steps.)
- **Write closing** (`set-closing.sh`) as soon as the topic is **de-facto closed**:
  our part is finished and what remains is on someone else — a decision, an operation
  on their side, or just telling them. It is the wrap-up the person reads / forwards.
  An empty `requester` is not an exemption: write it for whoever picks the topic up.
- **Toggle personal** (`set-personal.sh`) to move a task into / out of the hidden
  personal scope. At creation use `add-task.sh --personal` instead.

## Write simply

Everything you write here is read by a person, often at a glance, often later and
without the chat. Keep it short and plain:

- **Plain English, short sentences, one idea per line.** No filler, no preamble.
- **No jargon** unless the word is the name of the thing (a command, a file, a
  service). Say what changed for the person, not how the code is organized.
- **Titles:** 3–6 words, active voice ("Fix duplicate invoice emails").
- **Notes:** one line per event, starting with a verb ("Opened the PR for the fix.").
- **Steps:** one short action each, in order ("Add tests", "Open the PR").
- **Closing messages:** a few lines: what now works, what the reader still has to do,
  what is left open.
- **Issue and PR text you write** follows the same rules: short, plain, one idea per
  line.

If a line only makes sense to someone who saw the session, rewrite it.

## Milestone auto-noting convention

Keep the shared timeline honest without being asked. At each of these moments, write
to the matching endpoint — automatically, in the same turn the event happens:

| Moment | What to write | Endpoint / script |
| ------ | ------------- | ----------------- |
| **Task start** — you pick up a task | A note: you've started, plus the initial plan as steps | note + steps |
| **Decision** — you choose an approach | A note recording the decision and why | note (`add-note.sh`) |
| **Milestone done** — a step completes | A note for what got done; drop that step from the plan | note + steps |
| **Blocker** — you're stuck / waiting | A note naming the blocker and what would unblock it | note (`add-note.sh`) |
| **PR opened** — you push a change up | A note with the action + the PR ref | note (`add-note.sh`) |
| **Conclude** — the topic is closed, or de-facto closed | The closing handoff; mark the task done once it is actually over | closing + `done-task.sh` |

**Note shape.** One line, lead with a verb: `<verb> <what>`. Optionally a short *why*,
and a *ref* (a configured shorthand like `web#123`, or a URL). Cite the skill that
produced the action as a `[skill: <name>]` suffix. Examples:

```
Opened the PR for the cache fix. web#412 [skill: note-progress]
Blocked: need the staging deploy token to continue. [skill: note-progress]
Started: triage the failing import. Plan posted as steps. [skill: add-to-agenda]
```

## The human↔agent memory loop

The agenda is shared memory across sessions and across people. Use it as such:

- **notes = past**, **steps = future**, **closing = handoff**. Together they let
  anyone — a person, or a later agent session — reconstruct state without the original
  chat.
- **Re-ground at session start.** A new session does **not** inherit prior context.
  Before doing work, match the existing task (`list-tasks.sh`, then
  `show-task.sh <id>`) and read it back: notes tell you what happened, steps tell you
  what's left, closing tells you if it's already handed off. Then continue from there
  instead of starting over.
- **Prefer the task `id` across sessions.** A `match` substring favors *open* tasks and
  the one due soonest, so it can drift as the list changes or resolve to the wrong task
  once one is done. Capture the `id` returned at create time and reuse it; it is stable
  and unambiguous.
- **Write as you go, not at the end.** Each milestone (above) is a small, immediate
  write. That keeps the person's view live and means a crashed or replaced session
  loses nothing — the next session reads the timeline and resumes.
