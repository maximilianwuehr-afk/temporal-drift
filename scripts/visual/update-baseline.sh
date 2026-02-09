#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="$ROOT_DIR/tests/visual/baselines"
CURR="$ROOT_DIR/tests/visual/current"

mkdir -p "$BASE"
if [[ ! -d "$CURR" ]]; then
  echo "No current dir: $CURR. Run: npm run visual:capture"
  exit 1
fi

rm -f "$BASE"/*.png
cp "$CURR"/*.png "$BASE/"

echo "Updated baselines from current." 
