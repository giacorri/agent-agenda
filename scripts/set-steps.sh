#!/usr/bin/env bash
# set-steps — replace the whole "next steps" (forward plan) of a task in agent-agenda
#
# Usage:
#   set-steps <task-id|match> --step "..." [--step "..."]...
#   set-steps <task-id|match> --clear          # empties the plan
#
# <match> = ULID id, or a substring/tag/service of an open task (pending/in_progress/snoozed; earliest due date wins).
# This REPLACES the list (it is not append). Pass every step you want to keep, in order.
# Steps are the forward plan shown in the right column; when a step is done remove it here
# and log it as a note (add-note.sh). Each step is short, plain text, markdown ok.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
steps=()
clear=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --step)  steps+=("$2"); shift 2 ;;
    --clear) clear=1; shift ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$match" ]]; then
  echo "Required: <match>. Then --step \"...\" (repeatable) or --clear." >&2
  exit 2
fi
if [[ ${#steps[@]} -eq 0 && "$clear" -ne 1 ]]; then
  echo "No steps given. Use --step \"...\" or --clear to empty the plan." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }
json_arr() {
  local out="[" i=0
  for v in "$@"; do [[ $i -gt 0 ]] && out+=","; out+=$(json_str "$v"); i=$((i+1)); done
  out+="]"; printf '%s' "$out"
}

if [[ ${#steps[@]} -gt 0 ]]; then steps_j=$(json_arr "${steps[@]}"); else steps_j="[]"; fi

payload=$(cat <<JSON
{ "match": $(json_str "$match"), "steps": $steps_j }
JSON
)

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/ingest/steps" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "set-steps failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
