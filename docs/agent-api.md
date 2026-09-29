# agent-agenda — agent API reference

The precise reference for driving an agent-agenda instance over HTTP. Each endpoint
lists its method, path, JSON payload and the shell helper that wraps it. It follows the
backend code (`backend/src/index.ts`, `backend/src/api/{ingest,tasks,config}.ts`,
`backend/src/types.ts`).

For the operating guide (when to make which write, the memory loop, conventions) see
[AGENTS.md](../AGENTS.md). For first-run setup see
[setup-with-an-agent.md](setup-with-an-agent.md); for every configurable option see
[configuration.md](configuration.md).

## Conventions

- **Base URL:** `$AGENDA_URL`. The bundled scripts default to `http://localhost:4010`
  (the Docker Compose port). A backend started directly listens on `$PORT`, default `4000`.
- **Web app:** `$AGENDA_UI_URL` (default `http://localhost:4011`). `<AGENDA_UI_URL>/task/<id>`
  opens the agenda with that task's drawer; the scripts print it next to each task.
- **Content type:** all writes are `Content-Type: application/json`.
- **`<match>`:** endpoints that target an existing task take a `match`: a task **id**
  (a 26-character ULID), a case-insensitive substring of the title, or an exact tag /
  category key. Note, steps and link endpoints only match **open** tasks (`pending`,
  `in_progress`, `snoozed`) and pick the one due soonest. Closing and personal match
  **any** status, also search `requester`, and pick the most recently created task.
  Prefer the id: it is stable.
- **CORS:** only matters for browsers. `Access-Control-Allow-Origin` is sent when the
  request's `Origin` is in the `CORS_ORIGIN` allowlist (`*` allows any page). Agents
  calling from a shell are unaffected.
- **Errors:** failures return `{ "error": "<message>" }` with a 4xx status.
- **No authentication.** Anyone who can reach the API can read and write. See
  [self-hosting.md](self-hosting.md).

## Task object

Returned by the task and ingest endpoints. (Source: `Task` in `backend/src/types.ts`.)

```jsonc
{
  "id": "01J…",                 // ULID, stable
  "title": "string",
  "summary": "string | null",
  "due_at": "ISO-8601 | ''",    // '' = general task with no deadline
  "remind_at": "ISO-8601 | ''", // due_at minus remind_before_min
  "status": "pending | in_progress | done | snoozed | shelved",
  "priority": 2,                 // integer, lower = more important, default 2
  "services": ["string"],       // configured category keys
  "tags": ["string"],           // free-form labels
  "source": "agent | user",
  "requester": "string | null",
  "client": "string | null",    // the client/company the task is for
  "closing": "string | null",   // handoff message, markdown
  "agent_session": "string | null",
  "agent_cwd": "string | null",
  "created_at": "ISO-8601",
  "completed_at": "ISO-8601 | null",
  "notified_at": "ISO-8601 | null",
  "steps": ["string"],          // forward plan, ordered
  "blocked_by": [{ "id": "…", "title": "…", "status": "…" }],
  "blocks":     [{ "id": "…", "title": "…", "status": "…" }]
}
```

- `shelved` is terminal like `done` but is not a completion: the task and its notes are
  kept and it leaves the active agenda. Only `done` releases a dependent task. (The legacy input
  spelling `accantonato` is accepted and mapped to `shelved`.)
- Overdue is **not** a status: it is computed from `due_at` versus now.
- `blocked_by` lists the prerequisites that are not `done` or `shelved`; `blocks` lists the still-open
  tasks that wait on this one. Both are `[]` when empty. See
  [Blocking links](#blocking-links-dependencies).
- The list endpoint (`GET /api/tasks`) adds `note_count` and `last_note`
  (`{ body, kind, created_at }`). `GET /api/tasks/:id` adds a `notes` array.

Note object:

```jsonc
{
  "id": "01J…",
  "task_id": "01J…",
  "body": "string",
  "kind": "text | file | link",
  "created_at": "ISO-8601",
  "agent_session": "string | null"
}
```

## Ingest — create and update tasks

### Create a task

`POST /api/ingest` → `201` with the created task. Script: `add-task.sh`.

Only `title` is required. `when` is **natural language** ("tomorrow", "in 1 minute",
"friday 10am"; a few Italian forms such as "domani" or "tra 2 ore" also work), parsed in
the server's timezone (`TZ`). With no time of day it lands at the configured
`default_remind_time`. If `remind_before_min` (or the configured default) is `> 0`, the
reminder moves that many minutes before due. Omit `when` for a **general** task with no
deadline: it never fires a reminder. An unparseable `when` returns `400`.

```jsonc
{
  "title": "string",            // required
  "when": "tomorrow",           // optional; omitted = no deadline
  "summary": "string",          // optional
  "body": "string",             // optional; if non-empty, stored as the first note
  "steps": ["string"],          // optional, forward plan
  "services": ["string"],       // optional, configured category keys
  "tags": ["string"],           // optional, free-form labels
  "priority": 2,                 // optional, default 2
  "requester": "string",        // optional; trimmed, empty → null
  "client": "string",           // optional; trimmed, empty → null
  "closing": "string",          // optional handoff message
  "remind_before_min": 15,       // optional; minutes before due
  "personal": true,              // optional; adds the hidden-scope tag
  "agent_session": "string",    // optional
  "agent_cwd": "string",        // optional
  "blocks": "keyword",          // optional; matched task waits on THIS new task
  "blocked_by": "keyword"       // optional; new task waits on the matched task
}
```

- `source` is always `"agent"` for ingested tasks. A non-empty `body` becomes a `text`
  note on the new task (it is not stored on the task itself).
- `personal: true` adds the tag of the first configured scope that has a non-empty tag
  (falling back to `personal` when no such scope exists), the same tag
  `/api/ingest/personal` toggles.
- A tag equal to a configured client key is moved into `client` when `client` is empty.
- `blocks` / `blocked_by` create a [blocking link](#blocking-links-dependencies) against
  an existing open task. An unmatched keyword is ignored and the task is still created.

```bash
add-task.sh --title "Review the import fix" --when "tomorrow 10am" \
  --summary "Check the failing CSV import" \
  --service backend --tag review --requester Alex --client northwind --remind-min 15 \
  --step "reproduce locally" --step "confirm the fix" --step "reply to requester"
add-task.sh --title "Renew passport" --personal         # no --when: general task
```

### Add a timeline note

`POST /api/ingest/note` → `201` with `{ task_id, note }`. Script: `add-note.sh`.

```jsonc
{
  "match": "string",            // required, task id or keyword (open tasks)
  "body": "string",             // required, markdown
  "kind": "text",               // optional: text | file | link, default text
  "agent_session": "string"     // optional
}
```

```bash
add-note.sh <match> --body "Opened the PR for the fix. web#412" --kind text
attach-file.sh <match> /path/to/report.pdf              # a `file` note
```

Returns `404` if no open task matches.

### Replace the forward plan (next steps)

`POST /api/ingest/steps` → `200` with `{ task_id, steps }`. Script: `set-steps.sh`.

This **replaces the whole list**; it does not append. Pass every step you want to keep,
in order. Blank entries are dropped.

```jsonc
{
  "match": "string",            // required (open tasks)
  "steps": ["string"]           // required; replaces the entire plan
}
```

```bash
set-steps.sh <match> --step "confirm the fix" --step "reply to requester"
set-steps.sh <match> --clear        # empties the plan
```

Returns `404` if no open task matches.

### Write the closing / handoff message

`POST /api/ingest/closing` → `200` with `{ task_id, closing }`. Script: `set-closing.sh`.

Matches **any** status (a closing is often written on a task already marked done). An
empty string clears the closing (stored as `null`).

```jsonc
{
  "match": "string",            // required (any status)
  "closing": "string"           // required; "" clears it
}
```

```bash
set-closing.sh <match> --message "Done. The fix is merged and the import passes. web#412"
set-closing.sh <match> --file ./handoff.md
set-closing.sh <match> --clear
```

### Toggle a task personal

`POST /api/ingest/personal` → `200` with `{ task_id, personal, tags }`. Script:
`set-personal.sh`. Matches **any** status. Adds or removes the hidden-scope tag (the tag
of the first configured scope with a non-empty tag; falls back to `personal`).

```jsonc
{
  "match": "string",            // required (any status)
  "personal": true              // required boolean
}
```

```bash
set-personal.sh <match>         # mark personal
set-personal.sh <match> --off   # unmark
```

### Blocking links (dependencies)

A task can depend on prerequisites. While any prerequisite is not `done` or `shelved` the dependent task is **blocked**: still visible, but it fires no reminders until it is
unblocked, then reactivates on its own. `blocked` is derived from the links, never a
stored status. Cycles and duplicate links are rejected.

**Link two existing tasks:** `POST /api/ingest/link` → `201` with
`{ blocked, blocked_by }` (the two task ids). Both are matches against open tasks (or
ids); `blocked` ends up depending on `blocked_by`.

```jsonc
{
  "blocked": "string",          // required; the task that will wait (match)
  "blocked_by": "string"        // required; its prerequisite (match)
}
```

`404` if either match fails; `409` on a duplicate link or a cycle.

**REST endpoints** (used by the web UI):

- `POST /api/tasks/:id/deps` with `{ "depends_on": "<id>" }` → `200` with the updated
  task. `400` self-link, `404` unknown task, `409` duplicate or cycle.
- `DELETE /api/tasks/:id/deps/:depId` → `204`.

At create time, `add-task.sh --blocked-by "<kw>"` / `--blocks "<kw>"` set the
`blocked_by` / `blocks` fields of [`POST /api/ingest`](#create-a-task).

## Tasks — read and lifecycle

### List / filter tasks

`GET /api/tasks` → `200` with an array of tasks (each with `note_count` and
`last_note`), ordered by due date with no-deadline tasks last. Script: `list-tasks.sh`
(or `agenda-check.sh` for a grouped "what is open and what is late" view). All query
params are optional:

| Param | Meaning |
| ----- | ------- |
| `status` | `pending` \| `in_progress` \| `done` \| `snoozed` \| `shelved` \| `all` |
| `from` | lower bound on due time (ISO, inclusive) |
| `to` | upper bound on due time (ISO, exclusive) |
| `tag` | filter by a tag |
| `service` | filter by a category key |

```bash
list-tasks.sh --status pending --service backend
curl -s "$AGENDA_URL/api/tasks?status=pending&service=backend"
```

### Read one task (with notes)

`GET /api/tasks/:id` → `200` with the task plus a `notes` array, or `404`. Script:
`show-task.sh` (accepts an id or a match).

```bash
show-task.sh <id>
curl -s "$AGENDA_URL/api/tasks/<id>"
```

### Create a task (UI path)

`POST /api/tasks` → `201`. Takes task fields directly (`title` required; `due_at` /
`remind_at` as ISO strings, not natural language) and sets `source: "user"`. Agents
should prefer `POST /api/ingest`.

### Mark done

`POST /api/tasks/:id/done` → `200` with the updated task. Sets `status: "done"` and
`completed_at`. Script: `done-task.sh <id|match>`.

### Snooze

`POST /api/tasks/:id/snooze` → `200` with the updated task. Script: `snooze-task.sh`.
Moves `due_at` / `remind_at` forward, sets `status` back to `pending`, and clears
`notified_at`.

```jsonc
{ "until": "10m" }   // "10m" | "1h" | "tomorrow" | "1w" | any ISO-8601 timestamp
```

`10m` and `1h` count from the current due time (or from now for a general task).
`tomorrow` and `1w` land on that day at the configured `default_remind_time`. An ISO
string is used as is.

```bash
snooze-task.sh <id|match> 1h
snooze-task.sh <id|match> 2026-10-05T09:30:00Z
```

### Patch task fields

`PATCH /api/tasks/:id` → `200` with the updated task. Only the fields you send change.
Accepted fields: `title`, `summary`, `due_at`, `remind_at` (ISO or `""`), `status`,
`priority`, `tags`, `services`, `steps`, `requester`, `client`, `closing`,
`completed_at`. Wrongly typed values return `400`. Script for the title:
`set-title.sh <id|match> "New title"`.

```bash
curl -s -X PATCH "$AGENDA_URL/api/tasks/<id>" \
  -H 'Content-Type: application/json' \
  --data-binary '{ "priority": 1, "tags": ["review", "urgent"] }'
```

### Delete a task

`DELETE /api/tasks/:id` → `204`. (No wrapper script; use `curl`.)

## Notes — direct endpoints

The ingest note endpoint above is the usual path. Notes are also available by id:

- `GET /api/tasks/:id/notes` → list the task's notes.
- `POST /api/tasks/:id/notes` → `201`; body `{ "body": "string", "kind"?: "text|file|link", "agent_session"?: "string" }`.
- `PATCH /api/tasks/:id/notes/:noteId` → edit a note body; `{ "body": "string" }`.
  Script: `edit-note.sh <id|match> --last|--note-id <ULID> --body "…"`.
- `DELETE /api/tasks/:id/notes/:noteId` → `204`. Script:
  `del-note.sh <id|match> --last|--note-id <ULID>`.

## Config — setup and inspection

(Setup recipe in [setup-with-an-agent.md](setup-with-an-agent.md); every field in
[configuration.md](configuration.md).)

- `GET /api/config` → the full bundle `{ categories, people, clients, refs, scopes, settings }`.
- `GET /api/config/status` → `{ "configured": bool, "counts": { categories, people, clients, refs, scopes, settings } }`.
  Use it for liveness and first-run detection. Script: `config-status.sh`
  (exit `0` configured, `3` first run, `1` unreachable).
- `POST /api/config/bootstrap` → apply a whole config document in one idempotent call
  (upsert by primary key; never deletes). Returns the full bundle. Script:
  `bootstrap-config.sh`.
- `GET /api/config/settings` · `PATCH /api/config/settings` → read / patch the flat
  string-to-string settings map. Script: `set-settings.sh key=value …`.
- `POST /api/config/preset/student` → `201`; adds a `study` scope (type `study`) and two
  example subjects with exam dates relative to today. Idempotent.
- `POST /api/config/subjects/:key/distribute` → `200` with `{ updated }`; spreads the
  subject's unfinished topic tasks evenly from its start date to the exam date minus the
  review days. `400` if the key is not a subject with an `exam_date`.

Per-entity CRUD under `/api/config/{categories|people|clients|refs|scopes}`:

| Method | Path | Body / effect |
| ------ | ---- | ------------- |
| `GET` | `/api/config/{entity}` | list rows |
| `POST` | `/api/config/{entity}` | `201`; upserts a row (primary key required) |
| `PATCH` | `/api/config/{entity}/{id}` | update; primary key pinned to the URL id; `404` if absent |
| `DELETE` | `/api/config/{entity}/{id}` | `204` |

Primary keys: `key` for `categories`, `people`, `clients`, `scopes`; `shorthand` for
`refs`. Row shapes:

| Entity | Fields |
| ------ | ------ |
| `categories` | `key`, `label`, `icon`, `color`, `kind` (`service` \| `app` \| `subject`), `sort`; subjects also `exam_date`, `start_date`, `review_days` |
| `people` | `key`, `label`, `role`, `sort`, `photo` |
| `clients` | `key`, `label`, `sort`, `logo` |
| `refs` | `shorthand`, `owner_repo`, `host` (default `github.com`) |
| `scopes` | `key`, `label`, `tag`, `sort`, `icon`, `type` (`generic` \| `study`) |

`photo` and `logo` are a path/URL or a small `data:` URL (the bundle loads with every
page). A task's free-text `requester` / `client` resolves to a person / client when the
row's `key` appears in it (case-insensitive).

Scripts for single rows: `set-category.sh`, `set-person.sh`, `set-ref.sh`,
`set-scope.sh`.

### Settings keys read by the server

| Key | Meaning | Fallback |
| --- | ------- | -------- |
| `default_remind_time` | `"HH:MM"` time of day used when `when` has no time | `09:30` |
| `default_remind_before_min` | minutes **before** due to fire the reminder (`0` = at due) | `0` |
| `study.review_days` | default review days before an exam (study mode) | `3` |

Values are stored as strings; send them as strings.

## Live updates and health

- `GET /api/health` → `200 ok`.
- `GET /ws` upgrades to a WebSocket. The server pushes JSON messages:
  `task.created`, `task.updated`, `task.deleted`, `task.due` (a reminder fired),
  `note.added`, `note.updated`, `note.deleted`, `config.updated`. The client never needs
  to send anything.

The scheduler checks for due reminders every 30 seconds. With `NATIVE_NOTIFY=1` on a
macOS host it also shows a native notification.

## Recipe: pick up and run a task end to end

```bash
# 1. Liveness + first-run check.
config-status.sh                                  # 0 configured · 3 first run · 1 unreachable

# 2. Re-ground: find the task, read it back.
list-tasks.sh --status pending
show-task.sh <id>                                 # notes = past, steps = future

# 3. Start: note that you picked it up, post the plan.
add-note.sh <id> --body "Started: triage the import. [skill: add-to-agenda]"
set-steps.sh <id> --step "Reproduce" --step "Fix" --step "Reply"

# 4. Progress: one note per milestone; keep steps current.
add-note.sh <id> --body "Reproduced locally. Cause: file encoding. [skill: note-progress]"
set-steps.sh <id> --step "Fix" --step "Reply"

# 5. Conclude: closing handoff, then mark done.
set-closing.sh <id> --message "Fixed. The import passes and the PR is merged. web#412"
done-task.sh <id>
```
