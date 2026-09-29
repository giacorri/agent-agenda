# Security policy

## Deployment model

agent-agenda is a single-user tool with **no authentication by design**. Anyone who can
reach the backend API can read and change every task and setting.

- Run it on `localhost` (the bundled Docker Compose binds both ports to `127.0.0.1`), or
- put it behind a reverse proxy that handles authentication and TLS.

Do not expose the backend or the frontend directly to the internet. Keep `CORS_ORIGIN`
limited to the origins you actually use. See [docs/self-hosting.md](docs/self-hosting.md).

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub private vulnerability reporting](https://github.com/giacorri/agent-agenda/security/advisories/new).
Do not open a public issue.

Include the affected version or commit, steps to reproduce, and the impact you see.
You should get a first reply within a week.
