# Set up agent-agenda with an AI agent

agent-agenda **ships empty**. A fresh install has zero categories, people, clients,
repo mappings, scopes and settings: nothing is hardcoded in the app. You configure it
once, and the fastest way is to hand the job to an AI agent. (You can also use the
in-app wizard at `/onboarding` or the settings page; see
[configuration.md](configuration.md) for every option.)

The idea: you give your own agent (Claude Code, or any assistant that can run `curl`)
a short recipe prompt. The agent **interviews you** — what work areas you track, who
you report to, which repos you reference, whether you keep a single list or split
work and personal, when reminders should fire — and then writes the whole
configuration in one HTTP call to the bootstrap endpoint. No clicking through forms.

This guide documents the exact contract so the config the agent writes is correct on
the first try.

## How the app is configured

All setup lives in a small server-side config store with six entity types:

| Entity       | What it is                                        | Primary key  |
| ------------ | ------------------------------------------------- | ------------ |
| `categories` | work services, personal apps, study subjects      | `key`        |
| `people`     | who you report to / who requests tasks            | `key`        |
| `clients`    | the clients / companies the work is for            | `key`        |
| `refs`       | shorthand → repo mappings for auto-linking refs   | `shorthand`  |
| `scopes`     | work vs personal (or N) lists                     | `key`        |
| `settings`   | key/value app settings (reminder defaults, etc.)  | `key`        |

Two ways to write config:

- **Bootstrap (recommended for agents):** `POST /api/config/bootstrap` with a single
  JSON document containing any of the six sections. Applied in one shot.
- **Per-entity CRUD:** `POST/PATCH/DELETE /api/config/{categories|people|clients|refs|scopes}`
  and `PATCH /api/config/settings`, if you want to tweak one thing later.

### First-run check

Before configuring, an agent can branch on whether the app is already set up:

```bash
curl -s http://localhost:4010/api/config/status
```

```json
{
  "configured": false,
  "counts": { "categories": 0, "people": 0, "clients": 0, "refs": 0, "scopes": 0, "settings": 0 }
}
```

`configured` is `false` on a fresh install (all config tables empty) and `true` once
anything has been written. This is what the app uses to show the first-run state.

### Bootstrap is idempotent

Every section upserts **by primary key**, so re-applying the same document is a no-op,
and re-running with a changed `label` just updates that row. Sections are optional:
you can bootstrap only `categories`, or only `settings`, etc. **It never deletes**
anything — bootstrap only inserts/updates. To remove a row, use the per-entity
`DELETE` endpoint.

## The config document shape

`POST /api/config/bootstrap` accepts this document. Every top-level section is
optional. Field names below are exact.

### `categories` — work services and personal apps

The sidebar areas you track. `kind` separates work services, personal apps and study
subjects so the UI lists them in separate sections.

| Field   | Type                   | Required | Default     | Notes                                  |
| ------- | ---------------------- | -------- | ----------- | -------------------------------------- |
| `key`   | string                 | **yes**  | —           | canonical match token, e.g. `backend`      |
| `label` | string                 | no       | = `key`     | display name                           |
| `icon`  | string                 | no       | `dot`       | a built-in icon name (see [configuration.md](configuration.md)) |
| `color` | string                 | no       | `#8896a8`   | hex color                              |
| `kind`  | `"service"` \| `"app"` \| `"subject"` | no | `service` | `service` = work, `app` = personal, `subject` = an exam (study mode) |
| `sort`  | integer                | no       | `0`         | sidebar order                          |
| `exam_date`, `start_date` | ISO date | no  | `null`      | subjects only: the study window        |
| `review_days` | integer          | no       | `null`      | subjects only: days kept for review before the exam |

### `people` — who you report to / requesters

Known requesters ("who asked for the task"). `key` is the canonical match token used
when a task records its requester.

| Field   | Type    | Required | Default | Notes                              |
| ------- | ------- | -------- | ------- | ---------------------------------- |
| `key`   | string  | **yes**  | —       | canonical token, e.g. `alex`       |
| `label` | string  | no       | = `key` | display name                       |
| `role`  | string  | no       | `""`    | free text, e.g. `manager`          |
| `sort`  | integer | no       | `0`     | order                              |
| `photo` | string  | no       | `""`    | avatar: path/URL or small `data:` URL |

### `clients` — the companies the work is for

Known clients. Matched the same way as people: a task's free-text `client` resolves to
a row when the row's `key` appears in it (case-insensitive substring). Work-only — a
personal task carries no client.

| Field   | Type    | Required | Default | Notes                                        |
| ------- | ------- | -------- | ------- | -------------------------------------------- |
| `key`   | string  | **yes**  | —       | canonical token, e.g. `acme`                 |
| `label` | string  | no       | = `key` | display name                                 |
| `sort`  | integer | no       | `0`     | order                                        |
| `logo`  | string  | no       | `""`    | path/URL or `data:` URL; keep it small — the config bundle loads with every page |

### `refs` — shorthand → repo mappings

Maps a shorthand like `web#498` to a repo, so refs auto-link.

| Field        | Type    | Required | Default      | Notes                                 |
| ------------ | ------- | -------- | ------------ | ------------------------------------- |
| `shorthand`  | string  | **yes**  | —            | e.g. `web` (matches `web#498`)        |
| `owner_repo` | string  | **yes**  | —            | e.g. `acme/web-app`                   |
| `host`       | string  | no       | `github.com` | git host                              |

### `scopes` — work vs personal (or N lists)

A scope is a top-level filter. `tag` is the task tag that marks membership; an **empty
tag means the default scope** (tasks with no scope tag). For a single-list setup you
can skip scopes entirely; for work+personal, define two.

| Field   | Type    | Required | Default | Notes                                            |
| ------- | ------- | -------- | ------- | ------------------------------------------------ |
| `key`   | string  | **yes**  | —       | e.g. `work`                                      |
| `label` | string  | no       | = `key` | display name                                     |
| `tag`   | string  | no       | `""`    | task tag for membership; `""` = default scope    |
| `sort`  | integer | no       | `0`     | order                                            |
| `icon`  | string  | no       | `""`    | icon name or image path/URL                      |
| `type`  | `"generic"` \| `"study"` | no | `generic` | `study` turns on exam mode for the scope |

### `settings` — key/value

A flat string-to-string map. The keys the app reads:

| Key                         | Meaning                                                   | Fallback |
| --------------------------- | --------------------------------------------------------- | -------- |
| `default_remind_time`       | `"HH:MM"` time of day a reminder fires when no time given | `09:30`  |
| `default_remind_before_min` | minutes **before** due to fire the reminder (`0` = at due)| `0`      |
| `study.review_days`         | default review days before an exam (study mode)           | `3`      |

(Values are stored as strings — send them as strings.)

## A concrete bootstrap document

A realistic work+personal setup:

```json
{
  "categories": [
    { "key": "backend",  "label": "Backend",   "icon": "server", "color": "#5b8def", "kind": "service", "sort": 1 },
    { "key": "frontend", "label": "Frontend",  "icon": "monitor","color": "#7c5cff", "kind": "service", "sort": 2 },
    { "key": "infra",    "label": "Infra",     "icon": "cloud",  "color": "#2bb673", "kind": "service", "sort": 3 },
    { "key": "home",     "label": "Home",      "icon": "wrench", "color": "#ff7ac6", "kind": "app",     "sort": 1 }
  ],
  "people": [
    { "key": "alex",   "label": "Alex",   "role": "manager",  "sort": 1 },
    { "key": "sam",    "label": "Sam",    "role": "teammate", "sort": 2 },
    { "key": "jordan", "label": "Jordan", "role": "support",  "sort": 3 }
  ],
  "clients": [
    { "key": "northwind", "label": "Northwind", "sort": 1 },
    { "key": "globex",    "label": "Globex",    "sort": 2 }
  ],
  "refs": [
    { "shorthand": "web", "owner_repo": "acme/web-app",     "host": "github.com" },
    { "shorthand": "api", "owner_repo": "acme/api-service", "host": "github.com" }
  ],
  "scopes": [
    { "key": "work",     "label": "Work",     "tag": "",         "sort": 1 },
    { "key": "personal", "label": "Personal", "tag": "personal", "sort": 2 }
  ],
  "settings": {
    "default_remind_time": "09:30",
    "default_remind_before_min": "15"
  }
}
```

Apply it:

```bash
curl -s -X POST http://localhost:4010/api/config/bootstrap \
  -H 'Content-Type: application/json' \
  --data-binary @config.json
```

The response is the full config bundle (`categories`, `people`, `clients`, `refs`,
`scopes`, `settings`) as stored — handy for the agent to confirm what landed.

## End to end: empty install → first task

1. **Start the app** (Docker default): `docker compose up -d`, then open
   <http://localhost:4011>. The backend API is at `http://localhost:4010`.
2. **Check status:** `curl -s http://localhost:4010/api/config/status` → `configured: false`.
3. **Run the recipe prompt** (below) with your agent. It interviews you and POSTs the
   bootstrap document.
4. **Verify:** `curl -s http://localhost:4010/api/config/status` → `configured: true`
   with non-zero counts. The sidebar now shows your areas.
5. **Add the first task** to confirm the wiring:

   ```bash
   curl -s -X POST http://localhost:4010/api/ingest \
     -H 'Content-Type: application/json' \
     --data-binary '{
       "title": "Review the backend PR",
       "when": "tomorrow",
       "summary": "First task after setup",
       "services": ["backend"],
       "requester": "alex"
     }'
   ```

   `POST /api/ingest` requires only `title`. `when` is natural language ("tomorrow",
   "in 1 minute", "friday 10am"); leave it out for a task with no deadline. With no
   time given, the task lands at `default_remind_time`; with
   `default_remind_before_min` set, the reminder fires that much earlier. The task
   appears in the app immediately.

> The same `localhost:4010` API base is what the `scripts/add-task.sh` helper uses
> (`AGENDA_URL`, default `http://localhost:4010`). If you run the backend directly
> outside Docker it listens on `:4000` — adjust the base accordingly.

## Recipe prompt — paste this to your agent

Copy the block below into your own agent. It tells the agent how to interview you and
how to write the config.

````text
You are configuring my agent-agenda install. It ships empty; your job is to interview
me and then write the whole configuration in one call.

API base: http://localhost:4010   (use http://localhost:4000 if I'm running the
backend directly without Docker).

STEP 1 — Check first-run.
Run: curl -s <base>/api/config/status
If "configured" is already true, tell me what's there and ask whether to add to it or
stop. Bootstrap never deletes, so re-running is safe.

STEP 2 — Interview me. Ask, in plain language, one topic at a time:
  1. Scopes: do I keep ONE list, or split WORK + PERSONAL, or N separate lists?
     - one list  -> no scopes needed (skip the section)
     - work+personal -> scope "work" with tag "" (default) and "personal" with tag "personal"
     - N lists -> one scope per list; the main one gets tag "" (default)
  2. Areas I track (categories): the work services and personal apps I want in the
     sidebar. For each: a short key, a label, and whether it's a work "service" or a
     personal "app". Icon/color are optional — pick sensible ones if I don't care.
  3. People: who I report to or who requests my tasks. For each: a key, a label, and
     their role (manager, tech lead, colleague, ...).
  4. Clients (optional): the companies my work is for. For each: a key and a label.
  5. Repo refs (optional): shorthands like "web#498" and the owner/repo they map
     to (and host, default github.com).
  6. Reminder defaults: what time of day should reminders fire when I don't give a
     time (HH:MM, default 09:30)? How many minutes BEFORE a task's due time should the
     reminder fire (0 = exactly at due time)?

STEP 3 — Build the bootstrap document. Exact shape (every section optional):
  {
    "categories": [{ "key","label","icon","color","kind":"service"|"app","sort" }],
    (icon is one of: shield package gear document bot server database calendar layers
     monitor cpu headphones music tuner mushroom rocket book cloud wrench beaker spark
     bell key lock chart tag dot)
    "people":     [{ "key","label","role","sort" }],
    "clients":    [{ "key","label","sort" }],
    "refs":       [{ "shorthand","owner_repo","host" }],
    "scopes":     [{ "key","label","tag","sort" }],
    "settings":   { "default_remind_time":"HH:MM", "default_remind_before_min":"<int as string>" }
  }
  Rules: keys are short canonical tokens; only "key" (or "shorthand"/"owner_repo" for
  refs) is required, everything else has a default; settings values are STRINGS;
  scope tag "" means the default scope.

STEP 4 — Show me the JSON, get my OK, then POST it:
  curl -s -X POST <base>/api/config/bootstrap \
    -H 'Content-Type: application/json' \
    --data-binary @config.json
  The response is the full stored config — confirm the counts look right, then tell me
  it's done and that I can add tasks via POST /api/ingest (only "title" is required).
````

## Editing later

Bootstrap is fine to re-run; it upserts. For one-off tweaks use the per-entity
endpoints — e.g. rename a category:

```bash
curl -s -X PATCH http://localhost:4010/api/config/categories/backend \
  -H 'Content-Type: application/json' \
  --data-binary '{ "label": "Backend (renamed)" }'
```

or change a single setting:

```bash
curl -s -X PATCH http://localhost:4010/api/config/settings \
  -H 'Content-Type: application/json' \
  --data-binary '{ "default_remind_time": "08:45" }'
```

To remove something, `DELETE /api/config/{entity}/{id}` (the `id` is the primary key:
`key`, or `shorthand` for refs).
