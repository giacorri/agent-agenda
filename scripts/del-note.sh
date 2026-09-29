#!/usr/bin/env bash
# del-note — delete a single note from a task in agent-agenda
#
# Usage:
#   del-note <task-id|match> --last           # delete the most recent note
#   del-note <task-id|match> --note-id <ULID> # delete a specific note
#
# <match> = ULID task id, or a substring/tag/service of a pending task title.
# Use --last to undo a note you just wrote. Deleting is permanent.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

match=""
note_id=""
last=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --note-id) note_id="$2"; shift 2 ;;
    --last)    last=1; shift ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *)
      if [[ -z "$match" ]]; then match="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$match" || ( -z "$note_id" && "$last" -ne 1 ) ]]; then
  echo "Required: <match> and (--last | --note-id <ULID>)." >&2
  exit 2
fi

# Resolve task id + (optionally) the last note id, all in one python pass.
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

if [[ -z "${task_id:-}" ]]; then
  echo "no task matched \"$match\"" >&2; exit 1
fi
if [[ -z "${resolved_note:-}" ]]; then
  echo "no note to delete (task $task_id has none, or --note-id missing)" >&2; exit 1
fi

http_code=$(curl -sS -o /dev/null -w "%{http_code}" -X DELETE "$AGENDA_URL/api/tasks/$task_id/notes/$resolved_note")
if [[ "$http_code" != "204" ]]; then
  echo "del-note failed ($http_code) for note $resolved_note" >&2; exit 1
fi
echo "deleted note $resolved_note from task $task_id"
