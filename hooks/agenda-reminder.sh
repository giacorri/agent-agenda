#!/usr/bin/env bash
# Stop hook: the focus pane only shows what the agent writes. If this session's turn
# closed something on the task the pane follows (merged a PR, closed an issue, cut a
# release) but wrote nothing back to the agenda, block the stop once and ask the agent
# to log the step (note) and update the plan (steps).
#
# Ordinary work (edits, commands, opening a PR, review rounds, CI) never triggers it:
# notes are for milestones only, and a reminder on every working turn made agents log
# each intermediate pass just to satisfy it.
#
# Same opt-in as cmux-focus.sh: a no-op unless AGENDA_CMUX_FOCUS=1 inside cmux.
# AGENDA_LANG=it writes the reminder in Italian (the user sees it); default English.

[[ "${AGENDA_CMUX_FOCUS:-}" == 1 && -n "${CMUX_WORKSPACE_ID:-}" ]] || exit 0
command -v jq >/dev/null || exit 0

input=$(cat)
[[ "$(jq -r '.stop_hook_active // false' <<<"$input")" == true ]] && exit 0

state="${TMPDIR:-/tmp}/agent-agenda-focus/$CMUX_WORKSPACE_ID"
[[ -f "$state" ]] || exit 0
read -r _ id owner <"$state"
session=$(jq -r '.session_id // empty' <<<"$input")
[[ -n "$id" && "$owner" == "$session" ]] || exit 0

transcript=$(jq -r '.transcript_path // empty' <<<"$input")
[[ -f "$transcript" ]] || exit 0

# Tool calls since the last real user prompt: did the turn close something, and did
# it write to the agenda?
verdict=$(tail -n 2000 "$transcript" | jq -rs '
  [.[] | select(.type == "user" or .type == "assistant")] as $m
  | ($m | map(.type == "user" and (.isMeta | not)
        and ((.message.content | type) == "string" or any(.message.content[]?; .type == "text")))
      | indices(true) | last) as $i
  | if $i == null then "skip" else
      [$m[$i + 1:][] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use")] as $t
      | if any($t[]; .name == "Bash" and (.input.command // "" | test("add-note|set-steps|set-closing|done-task|set-status|edit-note|del-note|add-task")))
        then "wrote"
        elif any($t[]; .name == "Bash" and (.input.command // "" | test("gh +(pr +merge|issue +close|release +create)")))
        then "remind"
        else "skip" end
    end' 2>/dev/null)
[[ "$verdict" == remind ]] || exit 0

title=$(curl -sf --max-time 2 "${AGENDA_URL:-http://localhost:4010}/api/tasks/$id" | jq -r '.title // empty')
if [[ "${AGENDA_LANG:-}" == it ]]; then
  # Braces matter: without them bash can read the multibyte » as part of the name.
  label=""
  [[ -n "$title" ]] && label="«${title}» "
  # The user sees this text in the chat: one line. The criteria live in note-progress.
  reason="Agenda $label($id): una PR unita, una issue chiusa o una release senza nota. Se ha chiuso un passo del piano: note-progress e set-next-steps. Altrimenti niente, e fermati."
else
  reason="Agenda ${title:+\"$title\" }($id): a merged PR, closed issue or release with no note. If it closed a plan step: note-progress and set-next-steps. Otherwise nothing, and stop."
fi
jq -n --arg r "$reason" '{decision: "block", reason: $r}'
