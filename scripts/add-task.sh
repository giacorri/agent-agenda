#!/usr/bin/env bash
# add-task — create a task in agent-agenda (with short title + summary + optional long body)
#
# Usage:
#   add-task --title "..." --summary "..." [--when "tomorrow"] \
#            [--service <category> --service <category>]... [--tag x]... \
#            [--body "long text..."] [--remind-min N] [--requester "Name"] \
#            [--client "Acme"] [--personal] \
#            [--blocks "keyword"] [--blocked-by "keyword"]
#
# Conventions for agents calling this:
#   - title:    3-6 words, simple language, active voice, no technical components.
#   - summary:  1-2 lines, plain language, "what + why it matters" at a glance.
#   - service:  a configured category key (free-form; whatever you set up in the
#               app's config — see /settings). Repeat for multi-category tasks.
#               Do NOT put categories inside --tag.
#   - tag:      area/context (free-form, e.g. security, ops, review, deploy, …).
#   - body:     5-10 lines with bold/code/link/ref shorthand (e.g. repo#498, if you
#               configured that ref mapping). Prefer many short notes over a 20-item
#               checklist in the body.
#   - step:     one forward-plan next step (repeatable, ordered). Short text,
#               markdown ok. Goes in the right-hand "next steps" column, NOT the
#               body or notes. Update them later with set-steps.sh.
#   - requester: who asked for the task (free-form name). Omit it if the task is
#               your own idea (self-assigned). Known requesters drive the
#               closing-message register.
#   - client:   the client/company the work is for (free-form; a configured client
#               key gives it the sidebar row and the /client page). Work only —
#               omit it on personal tasks and on internal work with no customer.
#   - personal: --personal marks the task as belonging to the hidden scope (kept
#               out of the default views). Shorthand for --tag <hidden-scope-tag>.
#   - blocks / blocked-by: blocking links, matched by keyword against an existing
#               OPEN task (title/tag/service, or a task id). --blocked-by makes the
#               NEW task wait on the matched one (silenced until it's done).
#               --blocks makes the matched task wait on this NEW one. Unmatched
#               keyword → link skipped, task still created.
#
# The frontend shows title + summary on the card; body + next-steps live in the drawer.
#
# Output: the created task as JSON on stdout, and on stderr one "link: <url>" line —
# the deep link that opens the web app with this task's drawer. Web app origin =
# $AGENDA_UI_URL (default http://localhost:4011); $AGENDA_URL is the API (default :4010).

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"
: "${AGENDA_UI_URL:=http://localhost:4011}"

title=""
summary=""
body=""
when=""
remind=""
requester=""
client=""
personal="false"
blocks=""
blocked_by=""
tags=()
services=()
steps=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)       title="$2"; shift 2 ;;
    --summary)     summary="$2"; shift 2 ;;
    --body)        body="$2"; shift 2 ;;
    --step)        steps+=("$2"); shift 2 ;;
    --when)        when="$2"; shift 2 ;;
    --service)     services+=("$2"); shift 2 ;;
    --tag)         tags+=("$2"); shift 2 ;;
    --requester)   requester="$2"; shift 2 ;;
    --client)      client="$2"; shift 2 ;;
    --personal)    personal="true"; shift ;;
    --blocks)      blocks="$2"; shift 2 ;;
    --blocked-by)  blocked_by="$2"; shift 2 ;;
    --remind-min)  remind="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,42p' "$0"
      exit 0 ;;
    *)
      if [[ -z "$title" ]]; then title="$1"; else
        echo "unknown arg: $1" >&2; exit 2
      fi
      shift ;;
  esac
done

if [[ -z "$title" ]]; then
  echo "Required: --title \"...\". Recommended: --summary, --body, --tag; --when only if the user gave a date." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }
json_arr() {
  local out="["
  local i=0
  for v in "$@"; do
    [[ $i -gt 0 ]] && out+=","
    out+=$(json_str "$v")
    i=$((i+1))
  done
  out+="]"
  printf '%s' "$out"
}

title_j=$(json_str "$title")
summary_j=$(json_str "$summary")
body_j=$(json_str "$body")
# No --when → no "when" field: the API then creates a task with no due date and no
# reminder. Never invent a date here; a task without a deadline is a valid task.
when_field=""
if [[ -n "$when" ]]; then
  when_field="  \"when\": $(json_str "$when"),
"
fi
session_j=$(json_str "${CLAUDE_SESSION_ID:-}")
cwd_j=$(json_str "$(pwd)")
# Guard the empty-array case so each stays [] instead of [""].
if [[ ${#tags[@]} -gt 0 ]]; then tags_j=$(json_arr "${tags[@]}"); else tags_j="[]"; fi
if [[ ${#services[@]} -gt 0 ]]; then services_j=$(json_arr "${services[@]}"); else services_j="[]"; fi
if [[ ${#steps[@]} -gt 0 ]]; then steps_j=$(json_arr "${steps[@]}"); else steps_j="[]"; fi

remind_field=""
if [[ -n "$remind" ]]; then
  remind_field=", \"remind_before_min\": $remind"
fi

requester_field=""
if [[ -n "$requester" ]]; then
  requester_field=", \"requester\": $(json_str "$requester")"
fi

client_field=""
if [[ -n "$client" ]]; then
  client_field=", \"client\": $(json_str "$client")"
fi

deps_field=""
if [[ -n "$blocks" ]]; then
  deps_field+=", \"blocks\": $(json_str "$blocks")"
fi
if [[ -n "$blocked_by" ]]; then
  deps_field+=", \"blocked_by\": $(json_str "$blocked_by")"
fi

body=$(cat <<JSON
{
  "title": $title_j,
  "summary": $summary_j,
  "body": $body_j,
  "steps": $steps_j,
${when_field}  "services": $services_j,
  "tags": $tags_j,
  "personal": $personal,
  "agent_session": $session_j,
  "agent_cwd": $cwd_j$remind_field$requester_field$client_field$deps_field
}
JSON
)

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/ingest" \
  -H 'Content-Type: application/json' \
  --data-binary "$body")

http_code=$(printf '%s' "$response" | tail -n1)
payload=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "201" ]]; then
  echo "add-task failed ($http_code): $payload" >&2
  exit 1
fi

echo "$payload"

# Deep link for the reply, on stderr so stdout stays parseable JSON. The task is
# already created at this point: never let a failure here report a failed create.
id=$(printf '%s' "$payload" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' 2>/dev/null) || id=""
[[ -n "$id" ]] && echo "link: $AGENDA_UI_URL/task/$id" >&2
exit 0
