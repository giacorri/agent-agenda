---
name: delegate-prompt
description: |
  Produce a copy-paste prompt to hand a task (usually one from the connected
  agent-agenda) to another agent. Read-only: it calls no endpoint and changes
  nothing — it only generates text. Use when the user says "give me the prompt for
  this task", "the prompt to delegate this", "hand-off prompt", or after reviewing
  a task and wanting the block to delegate it. Output is ONE code block: a title
  line, the repo/context, the steps, and the caveats.
---

# delegate-prompt — a copy-paste prompt to delegate a task

Output: **one single code block** the user copies and pastes to another agent. This
skill is read-only — it produces text and calls no endpoint. If the task is in the
agenda, you may read it back first (see below) to pull the real title and steps, but
you write nothing.

## Fixed structure

```
<task title, exactly as it appears in the agenda — so the topic is obvious>
repo: <directory to cd into, e.g. service-x / acme/web-app>

<context: the problem in 1-2 lines — what exists, where it breaks>

To do:
1. <concrete step>
2. <concrete step>

<invariants / gotchas / "stop and ask" for high-impact actions>
```

## Optional read-back (read-only)

If the task lives in the agenda, pull its real title and forward plan so you do not
invent them:

```bash
: "${AGENDA_URL:=http://localhost:4010}"
show-task.sh "<match>"
# or over the API (needs jq):
id=$(curl -s "$AGENDA_URL/api/tasks?status=all" | jq -r --arg k "KEYWORD" '.[] | select(.title|test($k;"i")) | .id' | head -1)
curl -s "$AGENDA_URL/api/tasks/$id" | jq '{title, steps, summary}'
```

The prompt's steps should mirror the task's forward plan (the same next steps).

## Rules

- **First line = the task title**, exactly as in the agenda (the topic, no leading
  verb). Do not invent a different headline — the user must recognize the task.
- **Second line = `repo: <dir>`**, where the agent should cd.
- **Context = the problem** (not a summary of what you did): 1-2 lines.
- **Steps** = the task's forward plan, concrete and ordered.
- **Short, plain words, in the user's language, one idea per line**: no jargon unless it is the name of the
  thing; spell out a technical term in half a line if it is not obvious. Identifiers (files, branches, properties, commands) in backticks.
- **Issues/PRs as bare refs** (`repo#512`) so the agent can resolve them itself.
- **High impact → explicit STOP**: if a step touches production, shared databases,
  shared base branches, or infrastructure choices → write "stop and ask for my OK
  first" in the prompt. Never delegate irreversible actions blind.
- **Mini by default**: context + steps + caveats. No preamble, no walls.

## Example

```
Flaky signup test
repo: acme/web-app

The signup end-to-end test fails about one run in five on CI and never locally; it
waits on a fixed timeout instead of the confirmation email webhook, so slow runners
time out. Retries hide it and make the pipeline slow.

To do:
1. Reproduce it: run the test in a loop with CPU throttling until it fails.
2. Replace the fixed sleep with a wait on the webhook event (`waitForEvent('signup.confirmed')`).
3. Drop the retry wrapper from the CI job once it passes 50 runs in a row.

HARD invariant: never point the test at the staging mail server; never disable the test to go green.
```
