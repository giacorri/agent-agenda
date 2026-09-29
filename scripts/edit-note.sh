#!/usr/bin/env bash
# edit-note — rewrite the body of an existing note in agent-agenda
#
# Usage:
#   edit-note <task-id|match> --last        --body "new text..."
#   edit-note <task-id|match> --note-id <ULID> --body "new text..."
#
# <match> = ULID task id, or a substring/tag/service of a pending task title.
# Same note style as add-note: headline + story, bold, `code`, no date. Replaces the body.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
note_id=""
last=0
body=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --note-id) note_id="$2"; shift 2 ;;
    --last)    last=1; shift ;;
    --body)    body="$2"; shift 2 ;;
    -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$match" || -z "$body" || ( -z "$note_id" && "$last" -ne 1 ) ]]; then
  echo "Required: <match>, --body \"...\", and (--last | --note-id <ULID>)." >&2
  exit 2
fi

read -r task_id resolved_note < <(
  AGENDA_URL="$AGENDA_URL" MATCH="$match" NOTE_ID="$note_id" WANT_LAST="$last" python3 - <<'PY'
import os, json, urllib.request, sys
base = os.environ["AGENDA_URL"]; m = os.environ["MATCH"].lower()
note_id = os.environ["NOTE_ID"]; want_last = os.environ["WANT_LAST"] == "1"
tasks = json.load(urllib.request.urlopen(f"{base}/api/tasks"))
def hit(t):
    if t["id"] == os.environ["MATCH"]: return True
    if t.get("status") != "pending": return False
    hay = [t.get("title","")] + (t.get("tags") or []) + (t.get("services") or [])
    return any(m in str(x).lower() for x in hay)
cand = [t for t in tasks if hit(t)]
if not cand: print(""); sys.exit(0)
cand.sort(key=lambda t: t.get("due_at") or "")
tid = cand[0]["id"]
out_note = note_id
if want_last:
    full = json.load(urllib.request.urlopen(f"{base}/api/tasks/{tid}"))
    notes = full.get("notes") or []
    out_note = notes[-1]["id"] if notes else ""
print(tid, out_note)
PY
)

if [[ -z "${task_id:-}" ]]; then echo "no task matched \"$match\"" >&2; exit 1; fi
if [[ -z "${resolved_note:-}" ]]; then echo "no note to edit" >&2; exit 1; fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }
payload=$(printf '{ "body": %s }' "$(json_str "$body")")

response=$(curl -sS -w "\n%{http_code}" -X PATCH "$AGENDA_URL/api/tasks/$task_id/notes/$resolved_note" \
  -H 'Content-Type: application/json' --data-binary "$payload")
http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')
if [[ "$http_code" != "200" ]]; then
  echo "edit-note failed ($http_code): $out" >&2; exit 1
fi
echo "edited note $resolved_note on task $task_id"
