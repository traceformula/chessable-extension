#!/usr/bin/env bash
# Build the zip that gets uploaded to the Chrome Web Store.
# Only what the extension actually loads goes in: no tests, no tooling, no git.
set -euo pipefail
cd "$(dirname "$0")/.."

version=$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")
out="dist/chess-utility-extension-${version}.zip"

mkdir -p dist
rm -f "$out"
zip -q -r "$out" \
  manifest.json \
  popup.html \
  popup.js \
  options.html \
  options.js \
  icons \
  scripts \
  -x '*.DS_Store'

echo "$out"
# BSD head has no -n -N, so filter the listing rather than trimming it.
unzip -Z1 "$out" | grep -v '/$' | sed 's/^/  /'
