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
  reason="Il pannello dell'agenda segue il task $label($id): questo turno ha unito una PR, chiuso una issue o pubblicato una release, e in agenda non è stato scritto niente. Annota solo se si è chiuso un passo del piano, l'utente ha deciso qualcosa che cambia il piano, o è comparso o si è risolto un blocco: una frase sola di massimo 20 parole sul risultato (note-progress), e togli il passo finito dal piano (set-next-steps). Non si annotano agenti lanciati, PR aperte, giri di revisione o di correzione, CI, commenti: in quel caso, come quasi sempre, rispondi che non c'è niente da annotare e fermati."
else
  reason="The agenda focus pane follows task ${title:+\"$title\" }($id): this turn merged a PR, closed an issue or cut a release, and wrote nothing back. Log a note only if a plan step closed, the user made a decision that changes the plan, or a blocker appeared or cleared: a single sentence of at most 20 words on the outcome (note-progress), and drop the finished step from the plan (set-next-steps). Agents launched, PRs opened, review or fix rounds, CI, comments are never logged: then, as almost always, reply that there is nothing to log and stop."
fi
jq -n --arg r "$reason" '{decision: "block", reason: $r}'
