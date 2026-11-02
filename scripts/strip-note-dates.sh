#!/usr/bin/env bash
# strip-note-dates — remove the date written at the start of existing notes, on every task.
#
# Usage:
#   strip-note-dates            # preview: what would change, writes nothing
#   strip-note-dates --apply    # write the changes
#
# "2/11: merged the fix" becomes "Merged the fix". When the text named another day than
# the note's timestamp, the note is also redated to that day (like edit-note --at).
# Take a snapshot first (skills/tidy-agenda, step 0): the old bodies are not kept.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"
apply=0
case "${1:-}" in
  --apply) apply=1 ;;
  "") ;;
  -h|--help) sed -n '2,11p' "$0"; exit 0 ;;
  *) echo "unknown arg: $1" >&2; exit 2 ;;
esac

here=$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || echo "${BASH_SOURCE[0]}")")" && pwd)

AGENDA_URL="$AGENDA_URL" APPLY="$apply" python3 - "$here" <<'PY'
import json, os, sys, urllib.request
from datetime import datetime
sys.path.insert(0, sys.argv[1])
from note_date import date_prefix, resolve, strip

base, apply = os.environ["AGENDA_URL"], os.environ["APPLY"] == "1"

def call(method, path, body=None):
    req = urllib.request.Request(f"{base}{path}", method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as r:
        return json.load(r)

changed = redated = 0
for t in call("GET", "/api/tasks"):
    for n in call("GET", f"/api/tasks/{t['id']}").get("notes") or []:
        if n.get("kind", "text") != "text":
            continue
        hit = date_prefix(n["body"])
        if not hit:
            continue
        new = strip(n["body"])
        if not new.strip():
            print(f"skip (only a date): {t['title']} | {n['body']!r}")
            continue
        at = datetime.fromisoformat(n["created_at"].replace("Z", "+00:00")).astimezone()
        try:
            day = resolve(hit[1], hit[2], hit[3], at.date())
        except ValueError:  # 31/02 and the like: strip, keep the timestamp
            day = at.date()
        patch = {"body": new}
        if day != at.date():
            patch["created_at"] = day.isoformat()
            redated += 1
        changed += 1
        print(f"{t['title']}\n  - {n['body']}\n  + {new}"
              + (f"  [{at.date()} -> {day}]" if "created_at" in patch else ""))
        if apply:
            call("PATCH", f"/api/tasks/{t['id']}/notes/{n['id']}", patch)

verb = "changed" if apply else "would change"
print(f"\n{verb} {changed} notes ({redated} redated)."
      + ("" if apply else " Run with --apply to write."))
PY
