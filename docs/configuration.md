# Configuration

agent-agenda ships **empty**. There are no built-in categories, people, clients,
repositories or scopes: you decide what the agenda knows about, and you can change it
at any time. This page lists everything you can customize and every way to do it.

## Four ways to configure

All four write to the same config store (SQLite tables next to your tasks), so you can
mix them freely. Every change is pushed live to open browsers.

| Way | Best for | How |
| --- | --- | --- |
| **Setup wizard** | a first setup by hand | open `/onboarding` (also linked from the first-run screen and from Settings) |
| **Settings page** | day-to-day edits | open `/settings` |
| **Bootstrap JSON** | a full setup in one call, restoring a setup, sharing one | `POST /api/config/bootstrap` or `scripts/bootstrap-config.sh` |
| **Scripts / API** | an agent adding one item at a time | `scripts/set-category.sh`, `set-person.sh`, `set-ref.sh`, `set-scope.sh`, `set-settings.sh`, or the REST endpoints in [agent-api.md](agent-api.md#config--setup-and-inspection) |

The wizard asks three things (how to split tasks into scopes, your categories, the
people who send you work) plus the default reminder time, then applies them as one
bootstrap. The first-run screen also offers a **Student** preset (see
[Study mode](#study-mode)) and a link to the [agent setup guide](setup-with-an-agent.md),
where an agent interviews you and writes the config for you.

A bootstrap is **idempotent**: every row is upserted by its key, so re-applying the
same document changes nothing, and a partial document only touches the sections it
contains. It never deletes. A complete example lives in
[examples/example-config.json](examples/example-config.json).

```bash
scripts/bootstrap-config.sh docs/examples/example-config.json
# or
curl -X POST http://localhost:4010/api/config/bootstrap \
  -H 'Content-Type: application/json' -d @docs/examples/example-config.json
```

## Categories: services, apps and subjects

A category is an area a task belongs to. Tasks list category keys in `services`, and
each category gets a sidebar row, a colored chip on cards and a lane in the timeline.

| Field | Meaning | Default |
| --- | --- | --- |
| `key` | stable id, used in `services` and in the URL `/service/<key>` | required |
| `label` | display name | the key |
| `icon` | a built-in icon name (list below) | `dot` |
| `color` | any CSS color, usually `#rrggbb` | `#8896a8` |
| `kind` | `service` (work), `app` (personal) or `subject` (an exam, see [Study mode](#study-mode)) | `service` |
| `sort` | order in the sidebar | `0` |

`kind` only decides the sidebar group: **Services**, **Apps** or **Subjects**. Call
them whatever fits you: products, repositories, clients' systems, hobbies, courses.

**Built-in icons.** The Settings picker offers:
`shield`, `package`, `gear`, `document`, `bot`, `server`, `database`, `calendar`,
`layers`, `monitor`, `cpu`, `headphones`, `music`, `tuner`, `mushroom`, `rocket`,
`book`, `cloud`, `wrench`, `beaker`, `spark`, `bell`, `key`, `lock`, `chart`, `tag`,
`dot`. Through the API you can also use any other name defined in
`frontend/src/lib/components/Icon.svelte` (for example `globe`, `building`, `user`,
`folder`, `bug`, `eye`). An unknown name falls back to `dot`.

## People

People are the requesters who ask you (or your agent) for work. A task's free-text
`requester` is linked to a person when it **contains the person's key**
(case-insensitive), so `alex` matches "Alex", "alex@acme.test" or "Alex Doe".

| Field | Meaning |
| --- | --- |
| `key` | match token (lowercase is simplest) |
| `label` | display name |
| `role` | free text shown in Settings, e.g. "Engineering lead" |
| `photo` | optional avatar: a URL, a path served by the frontend, or a `data:` URL |
| `sort` | sidebar order |

Each person gets a sidebar row with a count and a page at `/requester/<name>`. In
Settings, picking an image downscales it to a small inline `data:` URL, so no file
upload service is needed. Without a photo the avatar is a neutral glyph.

## Clients

A client is the company a task is done for. A task's `client` field links to a
configured client the same way as people: by case-insensitive substring of the key.

| Field | Meaning |
| --- | --- |
| `key` | match token |
| `label` | display name |
| `logo` | optional: URL, path or `data:` URL (Settings downscales uploads) |
| `sort` | sidebar order |

Clients get a **Clients** section in the sidebar, a logo on task cards and a page at
`/client/<key>`. If an agent tags a task with a client's key instead of setting
`client`, the backend moves that tag into the `client` field.

Keep logos small: the whole config travels with every page load.

## Reference shorthands

A ref mapping turns short references in titles, notes, steps and closing messages into
links. It maps a `shorthand` to an `owner_repo` on a `host` (default `github.com`).

With `{ "shorthand": "web", "owner_repo": "acme/web-app" }`:

| You write | It links to |
| --- | --- |
| `web#42` | `https://github.com/acme/web-app/issues/42` |
| `web#PR42` | `https://github.com/acme/web-app/pull/42` |
| `#42` or `PR#42` | the same repo, when the task's services or tags match exactly one shorthand |
| `acme.web-app` | the repository root (dotted names only, so plain words never link by accident) |

Matching is tolerant: `web_app#42` or `acme-web#42` still resolve when the tail of the
name matches a configured shorthand or repo. GitHub redirects `/issues/N` to the pull
request when N is a PR, so plain `#N` works for both. Any host that serves
`/<owner>/<repo>/issues/<n>` works (GitHub, GitHub Enterprise, Gitea, Forgejo).

## Scopes

Scopes split the agenda into separate views, for example Work and Personal. They are
defined by tags:

| Field | Meaning |
| --- | --- |
| `key` | stable id |
| `label` | name shown in the scope switcher |
| `tag` | the task tag that puts a task in this scope; **empty = the default scope** |
| `icon` | an icon name, or an image path/URL served by the frontend (e.g. `/scope-work.png`) |
| `type` | `generic` or `study` (see [Study mode](#study-mode)) |
| `sort` | order in the switcher |

- Fewer than two scopes: no switcher, one agenda.
- The default scope shows every task that has **none** of the scope tags.
- A tagged scope shows only the tasks carrying its tag, and those tasks are hidden from
  the default scope.
- The switcher also has **All**. The choice is remembered per browser.

The first tagged scope is the "personal" scope for agents: `add-task.sh --personal`
and `set-personal.sh` add or remove its tag, whatever you named it. If no tagged scope
exists they fall back to the tag `personal`.

Image icons for scopes are not stored in the database. Put the file in
`frontend/static/` (files named `scope-*.png` are git-ignored) and rebuild the frontend.

## Reminders and other settings

Settings are a flat string map, edited in **Settings → Defaults**, with
`set-settings.sh key=value`, or with `PATCH /api/config/settings`.

| Key | Meaning | Fallback |
| --- | --- | --- |
| `default_remind_time` | time of day (`HH:MM`) used when a date has no time, and for snoozes to "tomorrow" / "1w" | `09:30` |
| `default_remind_before_min` | minutes before the due time that the reminder fires | `0` |
| `study.review_days` | default review days reserved before an exam | `3` |

The backend checks for due reminders every 30 seconds and pushes them to open browsers.
For desktop notifications, allow notifications in the browser. The backend can also
post a native macOS notification when it runs directly on a Mac with
`NATIVE_NOTIFY=1` (not inside Docker).

Reminders fire in the backend's time zone: set `TZ` (see below).

## Language

The UI ships in **English** and **Italian**. Change it in **Settings → Language**. The
choice is stored in the browser; without one, the app follows the browser's preferred
language and falls back to English. The date parser used by the API understands
English phrases ("tomorrow 10am", "in 3 days", "next monday") and a few Italian ones.
To add a language, see [i18n.md](i18n.md).

## Study mode

A scope with `type: "study"` turns on exam mode. Its categories use `kind: "subject"`
with three extra fields:

| Field | Meaning |
| --- | --- |
| `exam_date` | the exam day (`YYYY-MM-DD`), the final deadline |
| `start_date` | when studying starts (default: the day it was created) |
| `review_days` | days kept free for review before the exam (default: `study.review_days`) |

Topics are ordinary tasks listed under the subject. The sidebar shows each subject
with a countdown and progress, and the timeline shows the study window. **Distribute**
(in Settings, next to a subject, or `POST /api/config/subjects/<key>/distribute`)
spreads the unfinished topics evenly between today and the review period.

The quickest start is the **Student** card on the first-run screen (or
`POST /api/config/preset/student`): it adds a Study scope and two example subjects you
can rename. `cd backend && DB_PATH=./study-demo.db bun run seed:study` builds a full
demo database.

## Per-browser preferences

These live in the browser's local storage, not in the config store: the active scope,
the card layout (compact grid or sections), "peek" mode (expand cards on hover) and
the language.

## Environment variables

**Backend** (`backend/`):

| Variable | Meaning | Default |
| --- | --- | --- |
| `PORT` | HTTP + WebSocket port | `4000` (Compose publishes it on `4010`) |
| `DB_PATH` | SQLite file | `./tasks.db` (Compose: `/data/tasks.db`, i.e. `./data/tasks.db` on the host) |
| `CORS_ORIGIN` | comma-separated browser origins allowed to call the API, or `*` | `*` (Compose: its own frontend origins) |
| `TZ` | time zone for reminders and natural-language dates | system (Compose: `UTC`) |
| `NATIVE_NOTIFY` | `1` = native macOS notifications (backend run directly on a Mac) | off |

**Frontend** (`frontend/`, read at **build time** by Vite):

| Variable | Meaning | Default |
| --- | --- | --- |
| `VITE_API_URL` | backend base URL as seen by the browser | `http://localhost:4010` |
| `VITE_WS_URL` | backend WebSocket URL | `ws://localhost:4010/ws` |

**Scripts** (`scripts/`):

| Variable | Meaning | Default |
| --- | --- | --- |
| `AGENDA_URL` | backend base URL | `http://localhost:4010` |
| `AGENDA_UI_URL` | web app URL, used to print task links | `http://localhost:4011` |
| `CLAUDE_HOME` | where `install-claude-skills.sh` puts skills | `~/.claude` |
| `AGENDA_BIN_DIR` | where it links the helper scripts | `~/.local/bin` |

With Docker Compose, put overrides such as `TZ=Europe/Berlin` or `NATIVE_NOTIFY=1` in
a `.env` file next to `docker-compose.yaml`. Changing ports or hostnames is covered in
[self-hosting.md](self-hosting.md).

## Backing up and moving a setup

Config and tasks live in the same SQLite file (`./data/tasks.db` with Compose). Copy
that file to back up everything. To move only the setup, save the bundle and apply it
elsewhere:

```bash
curl -s http://localhost:4010/api/config > my-config.json
scripts/bootstrap-config.sh my-config.json   # against the new instance (AGENDA_URL=...)
```
