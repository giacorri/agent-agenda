#!/usr/bin/env bash
# test-hooks — the plugin hooks run after every Bash call and at every turn end of every
# session: for an event that does not concern them they must spawn nothing (no jq, cat,
# curl) and do nothing; for the right event they must still act.
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
real_jq=$(command -v jq)
mkdir "$tmp/shim"
# Shims log every spawn; a fake cmux records the calls the focus hook makes.
for tool in jq cat curl grep; do
  cat >"$tmp/shim/$tool" <<SH
#!/bin/bash
echo $tool >>"$tmp/spawns"
exec $( [[ $tool == jq ]] && echo "$real_jq" || command -v $tool ) "\$@"
SH
  chmod +x "$tmp/shim/$tool"
done
cat >"$tmp/shim/cmux" <<SH
#!/bin/bash
echo "\$*" >>"$tmp/cmux-calls"
case "\$1" in new-pane) echo "OK surface:7 pane:3";; esac
SH
chmod +x "$tmp/shim/cmux"

export PATH="$tmp/shim:$PATH" TMPDIR="$tmp" AGENDA_CMUX_FOCUS=1 CMUX_WORKSPACE_ID=ws1
fail=0
check() { # name, condition result
  if [[ $2 == ok ]]; then echo "ok   $1"; else echo "FAIL $1"; fail=1; fi
}
reset() { : >"$tmp/spawns"; : >"$tmp/cmux-calls"; rm -rf "$tmp/agent-agenda-focus"; }
spawns() { wc -l <"$tmp/spawns" | tr -d ' '; }

id=01ARZ3NDEKTSV4RRFFQ69G5FAV

# cmux-focus: unrelated command -> nothing spawned, nothing shown
reset
echo '{"tool_input":{"command":"ls -la"},"tool_response":{"stdout":""},"session_id":"s1"}' | "$root/hooks/cmux-focus.sh"
check "focus: unrelated command spawns nothing" "$([[ $(spawns) == 0 && ! -s $tmp/cmux-calls ]] && echo ok)"

# cmux-focus: an agenda script opens the pane
reset
echo "{\"tool_input\":{\"command\":\"show-task.sh $id\"},\"tool_response\":{\"stdout\":\"\"},\"session_id\":\"s1\"}" | "$root/hooks/cmux-focus.sh"
check "focus: agenda command opens the pane" "$(grep -q "new-pane.*/focus/$id" "$tmp/cmux-calls" && echo ok)"
check "focus: state records the owner" "$([[ $(cat "$tmp/agent-agenda-focus/ws1") == "surface:7 $id s1" ]] && echo ok)"

# agenda-reminder: another session -> nothing spawned
transcript="$tmp/t.jsonl"
cat >"$transcript" <<JSON
{"type":"user","message":{"content":"merge it"}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"gh pr merge 5 --squash"}}]}}
JSON
reset
mkdir -p "$tmp/agent-agenda-focus"; echo "surface:7 $id s1" >"$tmp/agent-agenda-focus/ws1"
out=$(echo "{\"session_id\":\"other\",\"transcript_path\":\"$transcript\"}" | "$root/hooks/agenda-reminder.sh")
check "reminder: other session spawns nothing" "$([[ $(spawns) == 0 && -z $out ]] && echo ok)"

# agenda-reminder: stop already continued -> nothing spawned
out=$(echo "{\"stop_hook_active\": true,\"session_id\":\"s1\",\"transcript_path\":\"$transcript\"}" | "$root/hooks/agenda-reminder.sh")
check "reminder: stop_hook_active spawns nothing" "$([[ $(spawns) == 0 && -z $out ]] && echo ok)"

# agenda-reminder: owner session that merged a PR without a note is reminded
out=$(echo "{\"session_id\":\"s1\",\"transcript_path\":\"$transcript\"}" | AGENDA_URL=http://127.0.0.1:9 "$root/hooks/agenda-reminder.sh")
check "reminder: owner with a merged PR is blocked" "$([[ $out == *'"decision": "block"'* ]] && echo ok)"

exit $fail
