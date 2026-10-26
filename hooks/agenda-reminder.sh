#!/usr/bin/env bash
# Stop hook: the focus pane only shows what the agent writes. If this session's turn
# did work on the task the pane follows but wrote nothing back to the agenda, block the
# stop once and ask the agent to log the step (note) and update the plan (steps).
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

# Tool calls since the last real user prompt: did the turn change anything, and did
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
        elif any($t[]; .name | test("^(Bash|Edit|Write|MultiEdit|NotebookEdit)$")) then "remind"
        else "skip" end
    end' 2>/dev/null)
[[ "$verdict" == remind ]] || exit 0

title=$(curl -sf --max-time 2 "${AGENDA_URL:-http://localhost:4010}/api/tasks/$id" | jq -r '.title // empty')
if [[ "${AGENDA_LANG:-}" == it ]]; then
  # Braces matter: without them bash can read the multibyte » as part of the name.
  label=""
  [[ -n "$title" ]] && label="«${title}» "
  reason="Il pannello dell'agenda segue il task $label($id) e in questo turno non è stato scritto niente. Se è stato fatto un passo, annotalo ora: una nota breve per fatto (note-progress) e togli il passo finito dal piano (set-next-steps). Se su quel task non è cambiato niente, rispondi che non c'è niente da annotare e fermati."
else
  reason="The agenda focus pane follows task ${title:+\"$title\" }($id), and this turn wrote nothing back to it. If a step got done here, log it now: one short note per fact (note-progress) and drop the finished step from the plan (set-next-steps). If nothing on that task moved, reply that there is nothing to log and stop."
fi
jq -n --arg r "$reason" '{decision: "block", reason: $r}'
