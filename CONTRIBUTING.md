# Contributing

Thanks for helping out. agent-agenda is a small local web app: a Bun + SQLite
backend and a SvelteKit frontend. This guide covers local setup, conventions, and
the PR process.

## Project layout

```
backend/            Bun + bun:sqlite API and WebSocket server
  src/              index.ts entrypoint, api/, parse/, db.ts, config-db.ts, scheduler.ts, seed.ts
  tests/            *.test.ts run with `bun run test`
frontend/           SvelteKit 2 (Svelte 5) app
  src/              routes/ and lib/ (api.ts, ws.ts, stores/, components/)
  messages/         UI strings, one JSON file per language
scripts/            shell helpers agents use to read and write tasks
.claude/skills/     installable agent skills (see scripts/install-claude-skills.sh)
docs/               user and agent documentation
docker-compose.yaml default way to run both services
```

## Prerequisites

- [Bun](https://bun.sh) 1.3 or newer. Both services build and run on Bun; you do
  not need Node or npm.

## Local development

Install dependencies in each service (Bun keeps them separate):

```bash
cd backend && bun install
cd ../frontend && bun install
```

Run the backend (it creates the SQLite file at `DB_PATH` on first start).
`bun run dev` uses `--hot`, so the server reloads on save. By default it listens on
port `4000`; setting `PORT=4010` matches the Docker setup and the scripts' default:

```bash
cd backend
PORT=4010 DB_PATH=../data/tasks.db bun run dev
```

For demo data, seed a separate database instead of your own:

```bash
cd backend
DB_PATH=./demo.db bun run seed        # wipes and refills demo.db only
```

Run the frontend, pointing it at the backend:

```bash
cd frontend
VITE_API_URL=http://localhost:4010 VITE_WS_URL=ws://localhost:4010/ws bun run dev
```

The frontend dev server listens on port `3000`. If the backend runs on its default
port `4000`, use `http://localhost:4000` and `ws://localhost:4000/ws` instead.

In dev mode the web app is therefore **not** on `4011`, which is where the agent
scripts point by default when they print a task's deep link. Export
`AGENDA_UI_URL=http://localhost:3000` (and `AGENDA_URL=http://localhost:4000` if
the backend runs directly) so the links they hand you actually open.

### Environment variables

| Service  | Variable       | Default                      | Purpose                              |
| -------- | -------------- | ---------------------------- | ------------------------------------ |
| backend  | `PORT`         | `4000`                       | HTTP/WebSocket listen port           |
| backend  | `DB_PATH`      | `./tasks.db`                 | SQLite database file path            |
| backend  | `NATIVE_NOTIFY`| `0`                          | `1` enables native notifications (macOS host) |
| backend  | `CORS_ORIGIN`  | `*`                          | Comma-separated browser origins allowed to call the API |
| backend  | `TZ`           | system timezone              | Timezone used to read natural-language dates |
| frontend | `VITE_API_URL` | `http://localhost:4010`      | Backend HTTP base URL                |
| frontend | `VITE_WS_URL`  | `ws://localhost:4010/ws`     | Backend WebSocket URL                |
| scripts  | `AGENDA_URL`   | `http://localhost:4010`      | Backend base URL the helpers call    |
| scripts  | `AGENDA_UI_URL`| `http://localhost:4011`      | Web app base URL used in task links  |

## Tests

Tests live in `backend/tests/` and run with Bun's built-in test runner:

```bash
cd backend && bun run test
```

The `test` script pins the timezone (`TZ=Europe/Rome bun test`) because some date
parsing and scheduler tests depend on it. Use `bun run test`, not a bare `bun test`.

When you add or change behavior in the backend, add a matching `*.test.ts` file (or
extend an existing one) under `backend/tests/`. Keep tests focused on the unit you
changed.

## Building the frontend

```bash
cd frontend && bun run build
```

This uses `@sveltejs/adapter-node` and emits a Node/Bun-runnable server under
`build/` (`build/index.js`).

## Code style and conventions

- **TypeScript** across backend and frontend. Prefer explicit types on public
  functions and API boundaries.
- **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`) for component
  state. Follow the patterns in the existing components rather than older Svelte
  store idioms.
- **Comments in English**, and only where they add value: invariants, non-obvious
  decisions, workarounds. Don't restate what the code already says.
- Keep diffs readable. Match the surrounding style instead of reformatting
  unrelated code.

## Pull request process

- **Small, focused PRs** — one topic per PR. Large or product-shaped changes are
  easier to review (and likelier to be accepted) if discussed in an issue first.
- **Conventional Commits** for commit messages and PR titles, e.g.
  `feat(frontend): add language switcher`, `fix(backend): clear notified_at on snooze`,
  `docs: add self-hosting guide`.
- Before opening the PR, run `bun run test` in `backend/` and `bun run build` in
  `frontend/`. CI runs both, plus `docker compose build`.
- New UI strings go in `frontend/messages/en.json` (and `it.json`); see
  [docs/i18n.md](docs/i18n.md).
- Explain the *why* in the PR description, not just the *what*.
