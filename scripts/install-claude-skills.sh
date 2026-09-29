#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
skill_src="$repo_root/.claude/skills"
claude_dir="${CLAUDE_HOME:-$HOME/.claude}"
skill_dest="$claude_dir/skills"
bin_dest="${AGENDA_BIN_DIR:-$HOME/.local/bin}"

skills=(
  agenda
  add-to-agenda
  note-progress
  set-next-steps
  handoff-recap
  delegate-prompt
  tidy-agenda
)

helpers=(
  add-task.sh
  add-note.sh
  set-steps.sh
  set-closing.sh
  list-tasks.sh
  show-task.sh
  done-task.sh
  snooze-task.sh
  config-status.sh
  set-settings.sh
  set-personal.sh
)

# Prints command usage and the environment variables this installer respects.
usage() {
  cat <<'USAGE'
Usage: scripts/install-claude-skills.sh

Installs agent-agenda Claude skills and helper commands from this repo.

Environment:
  CLAUDE_HOME     Claude config dir. Default: ~/.claude
  AGENDA_BIN_DIR  Directory for helper command symlinks. Default: ~/.local/bin
USAGE
}

# Copies one managed skill directory into Claude's global skills directory.
install_skill() {
  local name="$1"
  local src="$skill_src/$name"
  local dest="$skill_dest/$name"

  if [[ ! -f "$src/SKILL.md" ]]; then
    echo "missing skill: $src" >&2
    return 1
  fi

  rm -rf "$dest"
  cp -R "$src" "$dest"
  echo "installed skill: $name"
}

# Links one helper script into a directory that should already be on PATH.
install_helper() {
  local name="$1"
  local src="$repo_root/scripts/$name"
  local dest="$bin_dest/$name"

  if [[ ! -x "$src" ]]; then
    echo "missing executable helper: $src" >&2
    return 1
  fi

  if [[ -e "$dest" && ! -L "$dest" ]]; then
    echo "refusing to overwrite non-symlink: $dest" >&2
    return 1
  fi

  ln -sfn "$src" "$dest"
  echo "linked helper: $name"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

mkdir -p "$skill_dest" "$bin_dest"

for skill in "${skills[@]}"; do
  install_skill "$skill"
done

for helper in "${helpers[@]}"; do
  install_helper "$helper"
done

echo
echo "Done. Restart Claude Code or open a new session so it reloads global skills."
