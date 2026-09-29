#!/usr/bin/env bash
# attach-file — attach a local file path (as a `file` note) to an existing task
#
# Usage: attach-file <task-id|match> <absolute-path>

set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: attach-file <task-id|match> <absolute-path>" >&2
  exit 2
fi

match="$1"; path="$2"

if [[ "$path" != /* ]]; then
  path="$(cd "$(dirname "$path")" && pwd)/$(basename "$path")"
fi

if [[ ! -e "$path" ]]; then
  echo "file not found: $path" >&2; exit 1
fi

exec "$(dirname "$0")/add-note.sh" "$match" --body "$path" --kind file
