#!/usr/bin/env bash
# agenda-check — the "check my agenda" command. One read, grouped the way a human reviews it:
# overdue first (oldest, with a day count), then upcoming, work and personal kept apart.
#
# This is what an agent runs when told "check the agenda". It answers
# "what's open and how late am I?" in one shot, so nobody has to hand-roll a JSON filter again.
#
# Usage:
#   agenda-check                 # open tasks (pending + in_progress), overdue first, work + personal
#   agenda-check --overdue       # only the overdue ones
#   agenda-check --work          # hide personal (tag "personal") tasks
#   agenda-check --personal      # only personal tasks
#   agenda-check --upcoming N    # also widen the upcoming window to N days (default 7)
#   agenda-check --json          # raw JSON of the selected tasks instead of the grouped view
#
# "open" = pending or in_progress (the actionable ones). done/snoozed are excluded. A task is
# "overdue" when its due_at is in the past. Work vs personal is the "personal" tag convention
# (set-personal.sh). Sorting and the note/step counts come straight from the API list payload.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

only_overdue=0
scope="all"          # all | work | personal
upcoming_days=7
raw=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --overdue)  only_overdue=1; shift ;;
    --work)     scope="work"; shift ;;
    --personal) scope="personal"; shift ;;
    --upcoming) upcoming_days="$2"; shift 2 ;;
    --json)     raw=1; shift ;;
    -h|--help)  sed -n '2,21p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

response=$(curl -sS -w "\n%{http_code}" "$AGENDA_URL/api/tasks")
http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "agenda-check failed ($http_code): $out" >&2
  echo "(is the agenda backend up? AGENDA_URL=$AGENDA_URL)" >&2
  exit 1
fi

# The JSON is handed to python via a temp file, not stdin: the heredoc below already owns
# stdin, so a pipe would be swallowed by the heredoc and python would parse the script itself.
tmp=$(mktemp -t agenda-check)
trap 'rm -f "$tmp"' EXIT
printf '%s' "$out" > "$tmp"

AGENDA_JSON_FILE="$tmp" \
  ONLY_OVERDUE="$only_overdue" SCOPE="$scope" UPCOMING_DAYS="$upcoming_days" RAW="$raw" \
  python3 - <<'PY'
import json, os, sys
from datetime import datetime, timezone

with open(os.environ["AGENDA_JSON_FILE"], encoding="utf-8") as fh:
    tasks = json.load(fh)
only_overdue = os.environ["ONLY_OVERDUE"] == "1"
scope = os.environ["SCOPE"]
upcoming_days = int(os.environ["UPCOMING_DAYS"])
raw = os.environ["RAW"] == "1"
now = datetime.now(timezone.utc)

def parse(s):
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None

def is_personal(t):
    return "personal" in (t.get("tags") or [])

# open = actionable: pending or in_progress. done/snoozed drop out.
sel = []
for t in tasks:
    if t.get("status") not in ("pending", "in_progress"):
        continue
    if scope == "work" and is_personal(t):
        continue
    if scope == "personal" and not is_personal(t):
        continue
    sel.append(t)

if raw:
    print(json.dumps(sel, indent=2, ensure_ascii=False))
    sys.exit(0)

def bucket(t):
    due = parse(t.get("due_at"))
    if due and due < now:
        return "overdue"
    if due and (due - now).days <= upcoming_days:
        return "soon"
    return "later"

for t in sel:
    t["_due"] = parse(t.get("due_at"))
    t["_bucket"] = bucket(t)

sel.sort(key=lambda t: (t["_due"] or now))

def line(t):
    due = t["_due"]
    if due and due < now:
        age = (now - due).days
        when = f"-{age}d".rjust(5)
    elif due:
        din = (due - now).days
        when = f"+{din}d".rjust(5)
    else:
        when = "  -  "
    tid = t["id"][-6:]
    title = (t.get("title") or "")[:34].ljust(34)
    svc = (",".join(t.get("services") or []) or "-")[:18].ljust(18)
    st = t.get("status")
    nc = t.get("note_count") or 0
    ns = len(t.get("steps") or [])
    req = t.get("requester")
    reqtag = f" <{req}>" if req else ""
    ln = t.get("last_note") or {}
    last = (ln.get("body") if isinstance(ln, dict) else "") or ""
    last = last.replace("*", "").replace("\n", " ").strip()[:60]
    head = f"  {when}  [{tid}] {title} {svc} {st:<11} {nc}n/{ns}s{reqtag}"
    if last:
        head += f"\n           └ {last}"
    return head

def emit(label, items):
    if not items:
        return
    print(f"\n{label} ({len(items)})")
    for t in items:
        print(line(t))

work = [t for t in sel if not is_personal(t)]
pers = [t for t in sel if is_personal(t)]

def split(items):
    return (
        [t for t in items if t["_bucket"] == "overdue"],
        [t for t in items if t["_bucket"] == "soon"],
        [t for t in items if t["_bucket"] == "later"],
    )

w_over, w_soon, w_later = split(work)
p_over, p_soon, p_later = split(pers)

total = len(sel)
n_over = len(w_over) + len(p_over)
print(f"AGENDA · {total} open · {n_over} overdue", end="")
print(f" · now {now.astimezone().strftime('%Y-%m-%d %H:%M')}")

emit("WORK · overdue", w_over)
if not only_overdue:
    emit(f"WORK · upcoming (<= {upcoming_days}d)", w_soon)
    emit("WORK · later", w_later)
emit("PERSONAL · overdue", p_over)
if not only_overdue:
    emit(f"PERSONAL · upcoming (<= {upcoming_days}d)", p_soon)
    emit("PERSONAL · later", p_later)
PY
