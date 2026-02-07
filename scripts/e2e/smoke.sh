#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VAULT_DIR="${TD_TEST_VAULT:-$ROOT_DIR/tests/fixtures/vault}"
PLUGIN_ID="${TD_PLUGIN_ID:-temporal-drift}"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/$PLUGIN_ID"
REPORT_DIR="${TD_REPORT_DIR:-/tmp/temporal-drift-tests}"
SMOKE_DIR="$REPORT_DIR/smoke"
SMOKE_SHOT="$SMOKE_DIR/smoke-open.png"

mkdir -p "$PLUGIN_DIR" "$SMOKE_DIR"

if [[ "$OSTYPE" != darwin* ]]; then
  echo "smoke.sh requires macOS (open command + Obsidian app)."
  exit 1
fi

if ! command -v open >/dev/null 2>&1; then
  echo "Missing required command: open"
  exit 1
fi

if ! command -v peekaboo >/dev/null 2>&1; then
  echo "Missing required command: peekaboo"
  exit 1
fi

if ! open -Ra Obsidian; then
  echo "Obsidian app is not installed or not discoverable by 'open -a'."
  exit 1
fi

if [[ ! -f "$ROOT_DIR/main.js" ]]; then
  echo "main.js not found. Run 'npm run build' first."
  exit 1
fi

cp "$ROOT_DIR/main.js" "$PLUGIN_DIR/main.js"
cp "$ROOT_DIR/manifest.json" "$PLUGIN_DIR/manifest.json"
cp "$ROOT_DIR/styles.css" "$PLUGIN_DIR/styles.css"

VAULT_NAME="$(basename "$VAULT_DIR")"

open -a Obsidian "$VAULT_DIR"
sleep "${TD_SMOKE_BOOT_WAIT_SECS:-4}"

open "obsidian://open?vault=${VAULT_NAME}&file=Daily%20notes%2F2027-01-03.md"
sleep "${TD_SMOKE_ACTION_WAIT_SECS:-2}"

peekaboo image \
  --app Obsidian \
  --mode window \
  --window-title "${TD_SMOKE_WINDOW_TITLE:-${VAULT_NAME} - Obsidian}" \
  --path "$SMOKE_SHOT"

if [[ ! -s "$SMOKE_SHOT" ]]; then
  echo "Smoke screenshot was not captured: $SMOKE_SHOT"
  exit 1
fi

cat > "$SMOKE_DIR/smoke-report.json" <<EOF
{
  "vaultDir": "$VAULT_DIR",
  "pluginDir": "$PLUGIN_DIR",
  "screenshot": "$SMOKE_SHOT",
  "status": "pass"
}
EOF

echo "Smoke test passed. Screenshot: $SMOKE_SHOT"
