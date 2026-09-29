#!/usr/bin/env bash
# set-ref — create or update a ref mapping in agent-agenda (shorthand → owner/repo)
#
# Usage:
#   set-ref --shorthand web --owner-repo acme/web-app [--host github.com]
#   set-ref web --owner-repo acme/web-app           # shorthand as first positional
#
# A ref mapping auto-links refs like "web#42" in task bodies to a real repo issue/PR.
# `shorthand` is the token used in text; `owner-repo` is "owner/repo"; `host` defaults
# to github.com. Re-running with the same --shorthand updates the existing row (upsert).

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

shorthand=""
owner_repo=""
host=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --shorthand)  shorthand="$2"; shift 2 ;;
    --owner-repo) owner_repo="$2"; shift 2 ;;
    --host)       host="$2"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *)
      if [[ -z "$shorthand" ]]; then shorthand="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$shorthand" || -z "$owner_repo" ]]; then
  echo "Required: --shorthand \"...\" --owner-repo \"owner/repo\". Optional: --host." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

# host is optional; backend defaults it to github.com when omitted.
fields="\"shorthand\": $(json_str "$shorthand"), \"owner_repo\": $(json_str "$owner_repo")"
[[ -n "$host" ]] && fields+=", \"host\": $(json_str "$host")"

payload="{ $fields }"

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/config/refs" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "201" ]]; then
  echo "set-ref failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
