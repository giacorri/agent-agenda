#!/usr/bin/env bash
# release — cut a release from a clean, up-to-date main:
#   scripts/release.sh 0.5.0
# Bumps every version spot, moves [Unreleased] in CHANGELOG.md under the new version,
# commits, tags v<version>, pushes, creates the GitHub release, then rebuilds the
# local Docker stack if it is running from this checkout.
set -euo pipefail

usage() { echo "usage: scripts/release.sh <major.minor.patch>" >&2; exit 2; }
[[ $# -eq 1 && $1 =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage
new=$1
tag=v$new
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

die() { echo "release: $*" >&2; exit 1; }

[[ $(git branch --show-current) == main ]] || die "not on main"
[[ -z $(git status --porcelain) ]] || die "working tree not clean"
git fetch -q origin main
[[ $(git rev-parse HEAD) == $(git rev-parse origin/main) ]] || die "main differs from origin/main"
# Ask the remote: a stale local tag must neither block nor hide a published one.
git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null && die "tag $tag already exists on origin"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && die "local tag $tag exists; delete it first"

old=$(python3 -c 'import json;print(json.load(open("backend/package.json"))["version"])')
python3 - "$old" "$new" <<'EOF' || die "$new is not greater than $old"
import sys
o, n = (tuple(map(int, v.split("."))) for v in sys.argv[1:])
sys.exit(0 if n > o else 1)
EOF

python3 - "$old" "$new" <<'EOF'
import re, sys, datetime
old, new = sys.argv[1:]

def sub(path, pattern, repl, count=1):
    text = open(path).read()
    out, n = re.subn(pattern, repl, text, count=count)
    if n == 0:
        sys.exit(f"release: nothing to bump in {path}")
    open(path, "w").write(out)

version = r'("version":\s*")[^"]+(")'
for path in (".claude-plugin/plugin.json", ".claude-plugin/marketplace.json",
             "backend/package.json", "frontend/package.json"):
    sub(path, version, rf"\g<1>{new}\g<2>")
for path in ("README.md", "docs/self-hosting.md"):
    sub(path, rf"git checkout v{re.escape(old)}", f"git checkout v{new}", count=0)

log = open("CHANGELOG.md").read()
m = re.search(r"## \[Unreleased\]\n(.*?)(?=\n## \[)", log, re.S)
if not m or not m.group(1).strip():
    sys.exit("release: [Unreleased] in CHANGELOG.md is empty")
today = datetime.date.today().isoformat()
log = log.replace("## [Unreleased]\n", f"## [Unreleased]\n\n## [{new}] - {today}\n", 1)
log = re.sub(r"\[Unreleased\]: (.*/compare/)v[^.]+\.[^.]+\.[^.]+\.\.\.HEAD",
             rf"[Unreleased]: \g<1>v{new}...HEAD\n[{new}]: \g<1>v{old}...v{new}", log, count=1)
open("CHANGELOG.md", "w").write(log)
EOF

scripts/check-versions.sh

# Release notes = the new CHANGELOG section, without its heading.
notes=$(awk -v h="## [$new]" 'index($0,h)==1{on=1;next} on&&/^## \[/{exit} on' CHANGELOG.md)

git add -A
git commit -q -m "chore: release $new"
git tag -a "$tag" -m "$tag"
git push -q origin main "$tag"
gh release create "$tag" --title "$tag" --notes "$notes"

if [[ -n $(docker compose ps -q 2>/dev/null) ]]; then
  echo "rebuilding the local Docker stack on $tag"
  docker compose up -d --build
else
  echo "local Docker stack not running from this checkout; to update it: docker compose up -d --build"
fi
