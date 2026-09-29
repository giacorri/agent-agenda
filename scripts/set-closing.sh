#!/usr/bin/env bash
# set-closing — set the closing handoff message of a task in agent-agenda
#
# Usage:
#   set-closing <task-id|match> --message "The message for whoever asked for the task"
#   set-closing <task-id|match> --file /path/to/message.txt   # read message from a file
#   set-closing <task-id|match> --clear                       # removes the closing message
#
# <match> = ULID id, or a substring of title/tag/service/requester. Unlike add-note/set-steps,
# this searches tasks in ANY status (the closing message is usually set on a DONE task) and
# prefers the most recently created match. The message is the handoff text (e.g. from the handoff-recap skill);
# It shows as the Closing section in the task drawer. Markdown ok.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
message=""
file=""
clear=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --message) message="$2"; shift 2 ;;
    --file)    file="$2"; shift 2 ;;
    --clear)   clear=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$match" ]]; then
  echo "Required: <match>. Then --message \"...\" / --file PATH / --clear." >&2
  exit 2
fi
if [[ -n "$file" ]]; then
  [[ -f "$file" ]] || { echo "file not found: $file" >&2; exit 2; }
  message="$(cat "$file")"
fi
if [[ -z "$message" && "$clear" -ne 1 ]]; then
  echo "No message given. Use --message \"...\", --file PATH, or --clear." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

payload=$(cat <<JSON
{ "match": $(json_str "$match"), "closing": $(json_str "$message") }
JSON
)

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/ingest/closing" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "set-closing failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
