# Self-hosting

agent-agenda runs as two containers — a Bun + SQLite backend and a SvelteKit
frontend — wired together by `docker-compose.yaml`. This is the recommended way to
run your own instance.

## Quick start

From the repository root:

```bash
docker compose up -d --build
```

The compose file builds both images from `./backend` and `./frontend`, then exposes:

- frontend on `http://localhost:4011`
- backend on `http://localhost:4010`

Open `http://localhost:4011`. The app ships empty: the first-run screen offers the
setup wizard, the settings page, or an agent-driven setup. Every option is described in
[configuration.md](configuration.md).

Check that the backend is up:

```bash
curl -s http://localhost:4010/api/health      # → ok
```

To stop:

```bash
docker compose down
```

## Ports

Both services publish only on the loopback interface (`127.0.0.1`), so they are not
reachable from the network by default:

| Service  | Host (published)      | Container |
| -------- | --------------------- | --------- |
| frontend | `127.0.0.1:4011`      | `3000`    |
| backend  | `127.0.0.1:4010`      | `4000`    |

If you put this behind a reverse proxy on the same host, that binding is fine. To
expose a service directly on the LAN, drop the `127.0.0.1:` prefix in
`docker-compose.yaml` (and make sure a proxy or firewall is in front of it).

## Environment variables

Defined in `docker-compose.yaml`:

| Service  | Variable        | Compose value      | Purpose                                          |
| -------- | --------------- | ------------------ | ------------------------------------------------ |
| backend  | `PORT`          | `4000`             | Port the backend listens on inside the container |
| backend  | `DB_PATH`       | `/data/tasks.db`   | SQLite database file path                        |
| backend  | `TZ`            | `${TZ:-UTC}`       | **Set this to your timezone** (e.g. `Europe/Rome`, `America/New_York`). Natural-language times like "tomorrow 9:30" are interpreted in the server's timezone, so reminders fire at the wrong wall-clock if it's left at UTC and you're elsewhere. |
| backend  | `CORS_ORIGIN`   | `${CORS_ORIGIN:-http://localhost:4011,http://127.0.0.1:4011,http://agenda.localhost:4011}` | Comma-separated allowlist of browser origins allowed to call the API, or `*`. Defaults to the compose's own frontend; set it to your public frontend origin (e.g. `https://agenda.example.com`) when you put it behind a proxy. Unlisted origins get no `Access-Control-Allow-Origin` header, so a web page you visit cannot read or modify your data through the browser. |
| backend  | `NATIVE_NOTIFY` | `${NATIVE_NOTIFY:-0}` | `1` enables native notifications through `osascript`. This only works when the backend runs directly on a macOS host, not inside the Linux container. In-browser notifications work either way. |

The frontend reads `VITE_API_URL` and `VITE_WS_URL` at **build time**. They default to
`http://localhost:4010` and `ws://localhost:4010/ws`, which match the published
backend port. If you serve the app under a different host or domain, put them in
`frontend/.env.production` (Vite reads it during `bun run build`, including the Docker
build) and rebuild:

```bash
cat > frontend/.env.production <<'EOF'
VITE_API_URL=https://api.example.com
VITE_WS_URL=wss://api.example.com/ws
EOF
docker compose up -d --build
```

## Data persistence

The backend stores everything in a single SQLite file. The compose file mounts the
host directory `./data` into the container at `/data`, and `DB_PATH` points at
`/data/tasks.db`. The database is created automatically on first start.

```yaml
volumes:
  - ./data:/data:rw
```

Because the data lives on the host in `./data`, it survives container rebuilds and
`docker compose down`. To move an instance, copy that directory.

### Backup and restore

The whole state is one file plus its journal. With the stack stopped (to avoid a
mid-write copy):

```bash
docker compose down
cp -a data data-backup-$(date +%Y%m%d)
```

To restore, put the `tasks.db` file back into `./data` and start the stack again:

```bash
docker compose up -d
```

## Reverse proxy

Both services bind to localhost, so a reverse proxy (Caddy, nginx, Traefik) on the
same host can sit in front of them and add TLS, a domain and, importantly,
**authentication**: agent-agenda has no login of its own. See
[SECURITY.md](../SECURITY.md).

Two things to wire up:

1. Route normal traffic to the frontend on `127.0.0.1:4011`.
2. Make the backend reachable to the browser (it needs both HTTP and WebSocket).
   The frontend talks to the backend directly from the browser using
   `VITE_API_URL` / `VITE_WS_URL`, so those must resolve from the client. Either:
   - publish the backend at its own hostname (e.g. `api.example.com` → `127.0.0.1:4010`)
     and rebuild the frontend with `VITE_API_URL=https://api.example.com` and
     `VITE_WS_URL=wss://api.example.com/ws` (see above); or
   - proxy a path prefix (e.g. `/api` and `/ws`) on the same hostname to the
     backend, and set `VITE_API_URL` / `VITE_WS_URL` to that hostname.

The WebSocket endpoint is `/ws` — make sure your proxy is configured to upgrade
WebSocket connections on that path. When serving over HTTPS, use `wss://` for the
WebSocket URL.

Also add the public frontend origin to `CORS_ORIGIN` (for example
`CORS_ORIGIN=https://agenda.example.com`), or the browser will refuse the API responses.
