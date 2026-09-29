#!/usr/bin/env bash
# set-category — create or update a category in agent-agenda (services + personal apps)
#
# Usage:
#   set-category --key web --label "Web App" [--icon dot] [--color "#8896a8"] \
#                [--kind service|app] [--sort 0]
#   set-category web --label "Web App"        # key as first positional
#
# A category is a component shown on cards / in the sidebar. `kind` splits the two
# sidebar groups: 'service' (work components) vs 'app' (personal apps). Re-running
# with the same --key updates the existing row (upsert). Defaults: icon=dot,
# color=#8896a8, kind=service, sort=0.

set -euo pipefail

: "${AGENDA_URL:=http://localhost:4010}"

key=""
label=""
icon=""
color=""
kind=""
sort=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)   key="$2"; shift 2 ;;
    --label) label="$2"; shift 2 ;;
    --icon)  icon="$2"; shift 2 ;;
    --color) color="$2"; shift 2 ;;
    --kind)  kind="$2"; shift 2 ;;
    --sort)  sort="$2"; shift 2 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *)
      if [[ -z "$key" ]]; then key="$1"; shift; else
        echo "unknown arg: $1" >&2; exit 2
      fi ;;
  esac
done

if [[ -z "$key" ]]; then
  echo "Required: --key \"...\". Recommended: --label. Optional: --icon, --color, --kind, --sort." >&2
  exit 2
fi

json_str() { python3 -c 'import json,sys; print(json.dumps(sys.argv[1]), end="")' "$1"; }

# Only send fields the caller set; the backend fills the rest with defaults (and
# preserves existing values on update).
fields="\"key\": $(json_str "$key")"
[[ -n "$label" ]] && fields+=", \"label\": $(json_str "$label")"
[[ -n "$icon" ]]  && fields+=", \"icon\": $(json_str "$icon")"
[[ -n "$color" ]] && fields+=", \"color\": $(json_str "$color")"
[[ -n "$kind" ]]  && fields+=", \"kind\": $(json_str "$kind")"
[[ -n "$sort" ]]  && fields+=", \"sort\": $sort"

payload="{ $fields }"

response=$(curl -sS -w "\n%{http_code}" -X POST "$AGENDA_URL/api/config/categories" \
  -H 'Content-Type: application/json' --data-binary "$payload")

http_code=$(printf '%s' "$response" | tail -n1)
out=$(printf '%s' "$response" | sed '$d')

if [[ "$http_code" != "201" ]]; then
  echo "set-category failed ($http_code): $out" >&2
  exit 1
fi
echo "$out"
