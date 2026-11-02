#!/usr/bin/env bash
# test-note-guards — the refusals of add-note / edit-note, without a running agenda.
# AGENDA_URL points at a closed port: a refused note exits 2 before any request,
# an accepted one gets past the guards and fails on the connection (exit 1).
set -uo pipefail

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
export AGENDA_URL=http://127.0.0.1:9
fail=0

expect() { # <want: refused|accepted> <body>
  local want=$1 body=$2 script rc got
  for script in add-note edit-note; do
    if [[ $script == add-note ]]; then
      "$here/add-note.sh" t --body "$body" >/dev/null 2>&1; rc=$?
    else
      "$here/edit-note.sh" t --last --body "$body" >/dev/null 2>&1; rc=$?
    fi
    got=accepted; [[ $rc -eq 2 ]] && got=refused
    if [[ $got != "$want" ]]; then
      echo "FAIL $script: want $want, got $got (rc=$rc): $body"; fail=1
    fi
  done
}

expect refused  "2/11: merged the importer fix"
expect refused  "31/10 sera, deploy done"
expect refused  "2026-11-02 — released to production"
expect refused  "02/11/2026 released to production"
expect refused  "**2/11**: merged the importer fix"
expect refused  "$(printf 'w %.0s' {1..41})"
expect accepted "Merged the importer fix (repo#12)"
expect accepted "2/3 of the tests pass on staging"
expect accepted "Released v1.7.1"
expect accepted "Moved the release to 2/11"

# strip() keeps the sentence and capitalises it.
python3 - "$here" <<'PY' || fail=1
import sys; sys.path.insert(0, sys.argv[1])
from datetime import date
from note_date import strip, date_prefix, resolve
cases = {
    "2/11: merged the fix": "Merged the fix",
    "31/10 sera, deploy done": "Deploy done",
    "2026-11-02 — released": "Released",
    "Released v1.7.1": "Released v1.7.1",
}
bad = [(b, strip(b), w) for b, w in cases.items() if strip(b) != w]
_, d, m, y = date_prefix("31/12: x")
if resolve(d, m, y, date(2026, 1, 5)) != date(2025, 12, 31):
    bad.append(("31/12 on 2026-01-05", "", "2025-12-31"))
for b, got, want in bad:
    print(f"FAIL strip: {b!r} -> {got!r}, want {want!r}")
sys.exit(1 if bad else 0)
PY

[[ $fail -eq 0 ]] && echo "note guards: ok"
exit $fail
