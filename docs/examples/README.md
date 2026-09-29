# Example configuration

A fresh agent-agenda install ships with **no** categories, people, clients, refs,
scopes or settings, so the app opens on its first-run screen. This folder gives you a
complete, anonymized starting point you can load in one shot and then edit to taste.

[`example-config.json`](./example-config.json) is a full **bootstrap document**: the
exact JSON body that `POST /api/config/bootstrap` expects. It sets up a work/personal
scope split, a handful of categories (services and personal apps), three people, two
clients, two ref mappings and reminder defaults. Every field is explained in
[configuration.md](../configuration.md).

Treat it as a template, not a rule set. Rename keys, drop sections you don't need, add
your own — every entity upserts by key, so loading it is idempotent and re-running is
safe.

## What's inside

| Section | Example entries | Notes |
| --- | --- | --- |
| `scopes` | `work` (default), `personal` (tag `personal`) | Tasks tagged `personal` show only in the Personal scope; everything else is Work. The first tagged scope is also what `personal: true` / `set-personal.sh` use. |
| `categories` | `backend`, `frontend`, `infra`, `docs` (services) · `home`, `fitness` (personal apps) | `kind` is `service` or `app`; each has an `icon` and a `color`. |
| `people` | `alex`, `sam`, `jordan` | Used as task `requester` values: who asked for a task. |
| `clients` | `northwind`, `globex` | Used as task `client` values; each gets a sidebar row. Add a `logo` for a picture. |
| `refs` | `web → acme/web-app`, `api → acme/api-service` | Shorthand → `owner/repo`, so a ref like `web#42` auto-links. |
| `settings` | `default_remind_time`, `default_remind_before_min` | Server-side reminder defaults (`HH:MM` and minutes-before-due). |

## Load it

With the app running (defaults to `http://localhost:4010`; override with `AGENDA_URL`):

```bash
scripts/bootstrap-config.sh docs/examples/example-config.json
```

Or pipe it on stdin:

```bash
cat docs/examples/example-config.json | scripts/bootstrap-config.sh -
```

Or with plain `curl`:

```bash
curl -sS -X POST http://localhost:4010/api/config/bootstrap \
  -H 'Content-Type: application/json' \
  --data-binary @docs/examples/example-config.json
```

On success the server returns the resulting full config bundle. Check it landed with:

```bash
scripts/config-status.sh
```

## Conventions you might adopt

These are habits worth borrowing, not requirements. Copy the ones that fit how you
work and ignore the rest.

- **Personal reminders in a fixed evening slot.** A simple rule like "personal tasks
  land Sunday at 20:00 unless I say otherwise" keeps low-urgency personal items out of
  your workday. Pass the time in the natural-language `when`, for example
  `--when "sunday 20:00"` or `--when "2026-11-01 20:00"`. (Without a time, a task lands
  at `default_remind_time`.)

- **One note per milestone, not a giant checklist.** Prefer adding a short progress
  note each time something real happens (PR opened, blocker cleared, deploy done)
  over stuffing a 20-item to-do list into the task summary. The notes become a readable
  timeline; the summary stays stable.

- **Use `requester` to track who asked.** Set `requester` to one of your configured
  people (e.g. `alex`, `sam`) on tasks that came from someone else, and leave
  it empty for your own ideas. It records accountability and, if you wire up a
  closing message, lets you tailor the hand-off to the person who asked.

- **Split work and personal with a scope tag.** Keep one default scope (empty `tag`)
  for work and one tagged scope (e.g. `personal`) for everything else, so the
  personal items can be toggled out of your default views. Pick whatever tag name
  matches how you think about the divide.

Adapt freely: change the scope names, swap the categories for your real services and
apps, point the refs at your own repos, and set the reminder time you actually want.
