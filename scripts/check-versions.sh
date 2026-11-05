#!/usr/bin/env bash
# check-versions — fail when the plugin manifests and the two services disagree on the version.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

read_versions() {
  python3 - <<'EOF'
import json
print("plugin.json", json.load(open(".claude-plugin/plugin.json")).get("version", "<missing>"))
mp = json.load(open(".claude-plugin/marketplace.json"))
entry = next(p for p in mp["plugins"] if p["name"] == "agent-agenda")
print("marketplace.json", entry.get("version", "<missing>"))
print("backend/package.json", json.load(open("backend/package.json"))["version"])
print("frontend/package.json", json.load(open("frontend/package.json"))["version"])
EOF
}

versions=$(read_versions)
if [[ $(awk '{print $2}' <<<"$versions" | sort -u | wc -l) -ne 1 ]]; then
  echo "version mismatch:" >&2
  echo "$versions" >&2
  exit 1
fi
echo "versions aligned: $(awk 'NR==1{print $2}' <<<"$versions")"
