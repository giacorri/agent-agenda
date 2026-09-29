#!/usr/bin/env bash
# config-status — report whether agent-agenda is configured yet (first-run vs ready)
#
# Usage:
#   config-status            # prints "configured" or "first-run" + the raw counts
#   config-status --quiet    # print nothing, just set the exit code
#
# Exit code lets an agent branch without parsing output:
#   0 = configured (at least one category/person/ref/scope/setting exists)
#   3 = first-run  (all config tables empty)
#   1 = could not reach the backend
# On a first-run install, seed config with set-category.sh / set-person.sh /
# set-ref.sh / set-scope.sh, or apply a whole doc with bootstrap-config.sh.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

quiet=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --quiet) quiet=1; shift ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

response=$(curl -sS -w "\n%{http_code}" "$AGENDA_URL/api/config/status")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "200" ]]; then
  echo "config-status failed ($http_code): $out" >&2
  exit 1
fi

# `configured` is a top-level boolean in the status payload.
configured=$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["configured"])')

if [[ "$configured" == "True" ]]; then
  [[ "$quiet" -eq 1 ]] || { echo "configured"; echo "$out"; }
  exit 0
else
  [[ "$quiet" -eq 1 ]] || { echo "first-run"; echo "$out"; }
  exit 3
fi
