---
name: handoff-recap
description: |
  Write and save the closing handoff message of a task in the connected
  agent-agenda — the copy-paste block for whoever the work has to be reported to
  (its `requester`, or whoever will ask for that feature), saying what now works,
  what they still have to do, and what is left open. Use when a topic is done OR
  DE-FACTO CLOSED: our part is finished and what remains is not on us (a decision,
  a database or configuration operation on their side, or simply telling them).
  Trigger phrases: "the handoff", "basically closed", "only need to tell X",
  "what do I write to X", "give me the message for X" (or the same request in
  any language, e.g. "praticamente chiuso"). ALSO use when a next step reads
  "tell / send / write to <someone>": that step's content IS the closing and
  belongs in the closing field, never in the plan. Written in short, plain words, in the user's language,
  in the register spelled out below. Saves it on the task (closing field)
  AND shows it as one copy-paste block. The skill does NOT send anything: sending
  is the user's job.
---

# handoff-recap — the closing message of a task

The **closing** is the third plane of a task, next to notes (the past) and steps
(the forward plan): the text the user **forwards** to whoever asked for the work.
It stays visible on the task forever, including after it is done, so it is also
the answer to "how did that thing end?" months later.

This skill writes it, saves it on the task's `closing` field, and shows it as one
copy-paste block.

## When to write it — early, not at the very end

The closing is **not** a formality reserved for `status = done`. Write it as soon
as the topic is **de-facto closed**: the technical work is finished and what
remains is not on us — someone else's decision, an operation on their database or
configuration, a rollout on their side, or just telling them.

Write it when any of these is true:

- the last technical step is done and what is left is only communication;
- what remains is an action **the recipient** has to perform (typical: a row to add
  in each client's configuration before the feature turns on);
- the user says "basically closed", "only need to tell X", "only the database
  change is left";
- a **next step reads "send / tell / write to <person>"** — that is the
  closing leaking into the plan: write the real message here, and leave in the
  steps at most the bare send action, never its content;
- before marking the task done, always.

Only genuinely open work — the outcome is not known yet — has no closing to write.

## Who it is for

- **`requester` set** → that person. Look them up in config, their `role` calibrates
  the level of detail:
  `curl -s "$AGENDA_URL/api/config" | jq '[.people[] | {key, label, role}]'`
- **`requester` empty but there is a recipient in the facts** → whoever will ask
  for that feature, whoever picks the topic up next, the client. Write it
  impersonally, addressed to that class of people. Do **not** skip it: an empty
  closing on a closed topic is the failure this skill exists to prevent.
- **Nothing to hand over to anyone** (pure personal chore, no outcome anyone is
  waiting for) → skip, and say so in one line.

## Step 1 — read the task back

What was done is not invented: it lives in the task's **notes** (the timeline) and
in the summary. Read it first, keep the outcomes, drop the method.

```bash
: "${AGENDA_URL:=http://localhost:4010}"
show-task.sh "<match>"
```

Without `show-task.sh` (needs `jq`):

```bash
id=$(curl -s "$AGENDA_URL/api/tasks?status=all" \
  | jq -r --arg k "KEYWORD" '.[] | select((.title+" "+(.requester//""))|test($k;"i")) | .id' | head -1)
curl -s "$AGENDA_URL/api/tasks/$id" | jq '{title, requester, summary, steps, notes: [.notes[].body]}'
```

## Step 2 — write the message

**Register — descriptive, impersonal, readable cold, and never recognisably
written by an AI.** Write it in short, plain words, in the user's language: one idea per line, everyday
words, no jargon unless it is the name of the thing. The rules, no exceptions:

- **No headings and no bold labels used as a rubric** (`**What is left**:`). It is a
  message, not a form. Bold goes *inline* on the key terms — the outcome, the number
  that matters, the thing to do — and `code` on every technical name. Both are
  required: the message must be scannable, never a flat wall.
- **No narrative first person.** Say what works now, not "I fixed", "I checked".
- **No shortcuts for context.** An issue number, a PR, an internal codename or a
  bare acronym never carries the meaning of a sentence: name the real effect, and
  leave the reference at the tail. The reader has not followed the work.
- **No jargon or buzzwords** where an ordinary word does the job.

**Content — three things, in this order. The second is the one that gets forgotten:**

1. **What now works**, concretely: the result and the number that proves it, not
   the steps taken to get there.
2. **What the recipient still has to do** for it to take effect: the manual
   operation, the configuration entry, the decision. Say it even when it is
   obvious to you — it is exactly the part that never travels on its own. If
   there is nothing, write that there is nothing to do.
3. **What is left open**, if anything: unanswered questions, parts not covered,
   what happens meanwhile.

Length: **4-10 sentences**, in 2-3 short paragraphs, or a short paragraph plus
bullets when there are ≥2 parallel points. Trivial case → 1-2 lines and stop.
No AI signature, and no closing pleasantry ("let me know if you need anything").

## Step 3 — save it, then show it

```bash
set-closing.sh "<match>" --file /path/to/message.md
```

`--message "…"` works for short text; for anything with backticks or newlines use
`--file` (the shell would eat them). `<match>` is a task id or a substring of
title / tag / service / requester, searched across **all** statuses. `--clear`
removes it.

Then show the user **one** copy-paste block with the message, plus one line on the
channel (privately rather than in a public thread) if it matters. The skill does not send
anything.

**Last check — the plan must not still contain the message.** If a step said
"send the message to X", rewrite the steps with `set-next-steps` so only the
bare action survives, without its content.

## Good example (topic de-facto closed, action left on the recipient)

> The nightly export runs again and has held for two weeks: **zero failures in
> seven days**, against the 40-odd a day it used to pile up. Large files no longer
> stop it, because it now reads them row by row instead of all at once.
>
> For it to stay that way on a new install, the export folder has to be writable by
> the service account: where it is not, the run stops and says so, instead of
> reporting a success that wrote nothing. On the machines running today it already
> is, so nothing needs doing — the check only matters on a fresh one.
>
> One question is still open: where the 50-file-per-run cap comes from, since the
> code itself only bounds the queue.

## Bad example (do not produce)

> ## Summary
>
> **What was done**: I fixed the authentication chain and checked the logs against
> repo#412…

(A heading, a bold label used as a rubric, narrative first person, and an issue
number standing in for the context — the four tells the register forbids. And it
stops at what was done, without saying what the recipient has to do.)

If the agenda scripts are not on PATH, call them by full path from the agenda
repo's `scripts/` dir, or post to the endpoints under `$AGENDA_URL` (default
`http://localhost:4010`).
