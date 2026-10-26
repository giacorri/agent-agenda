#!/usr/bin/env bash
# PostToolUse hook: when the agent reads or writes an agenda task from inside cmux, show
# that task's read-only /focus view in a narrow browser pane of the same workspace.
#
# Opt-in: a no-op unless AGENDA_CMUX_FOCUS=1 and the session runs in cmux.
#   AGENDA_CMUX_FOCUS_WIDTH  pane width in px (default 400)
#   AGENDA_UI_URL            web app origin (default http://localhost:4011)
#
# One pane per workspace, reused: touching another task navigates it there. Closing the
# pane keeps it closed until the agent moves on to a different task.

[[ "${AGENDA_CMUX_FOCUS:-}" == 1 && -n "${CMUX_WORKSPACE_ID:-}" ]] || exit 0
command -v cmux >/dev/null && command -v jq >/dev/null || exit 0

input=$(cat)
cmd=$(jq -r '.tool_input.command // empty' <<<"$input")
[[ "$cmd" =~ (show-task|add-task|add-note|edit-note|set-steps|set-closing|set-status|set-title|done-task|snooze-task) ]] || exit 0

ulid='01[0-9A-HJKMNP-TV-Z]{24}'
out=$(jq -r '.tool_response | if type == "object" then (.stdout // "") else tostring end' <<<"$input")
# An explicit id in the command wins; otherwise the task the script resolved and printed.
id=$(grep -oE "$ulid" <<<"$cmd" | head -1)
[[ -n "$id" ]] || id=$(grep -oE "/task/$ulid" <<<"$out" | head -1 | cut -d/ -f3)
[[ -n "$id" ]] || id=$(grep -oE "$ulid" <<<"$out" | head -1)
[[ -n "$id" ]] || exit 0

url="${AGENDA_UI_URL:-http://localhost:4011}/focus/$id"
state="${TMPDIR:-/tmp}/agent-agenda-focus/$CMUX_WORKSPACE_ID"
mkdir -p "${state%/*}"

surface="" shown=""
[[ -f "$state" ]] && read -r surface shown <"$state"
[[ "$shown" == "$id" ]] && exit 0

if [[ -n "$surface" ]] && cmux browser --surface "$surface" get-url >/dev/null 2>&1; then
  cmux browser --surface "$surface" navigate "$url" >/dev/null 2>&1
else
  created=$(cmux new-pane --type browser --direction right --url "$url" --focus false 2>/dev/null) || exit 0
  surface=$(grep -oE 'surface:[0-9]+' <<<"$created" | head -1)
  [[ -n "$surface" ]] || exit 0
  # Size it from the pane frames, which cmux keeps current even while the workspace is
  # hidden (the page's innerWidth is stale until it is shown).
  pane=$(grep -oE 'pane:[0-9]+' <<<"$created" | head -1)
  caller=$(cmux identify 2>/dev/null | jq -r '.caller.pane_ref // empty')
  width=$(cmux --json list-panes 2>/dev/null | jq -r --arg p "$pane" '.panes[] | select(.ref == $p) | .pixel_frame.width | floor')
  extra=$(( ${width:-0} - ${AGENDA_CMUX_FOCUS_WIDTH:-400} ))
  if [[ -n "$caller" && -n "$width" && $extra -gt 0 ]]; then
    cmux resize-pane --pane "$caller" -R --amount "$extra" >/dev/null 2>&1
  fi
fi
echo "$surface $id" >"$state"
exit 0
