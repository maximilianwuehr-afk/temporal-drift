#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VAULT_DIR="${TD_TEST_VAULT:-$ROOT_DIR/tests/fixtures/vault}"
PLUGIN_ID="${TD_PLUGIN_ID:-temporal-drift}"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/$PLUGIN_ID"
REPORT_DIR="${TD_REPORT_DIR:-/tmp/temporal-drift-tests}"
OUT_DIR="$REPORT_DIR/current"

mkdir -p "$OUT_DIR" "$PLUGIN_DIR"

if [[ "$OSTYPE" != darwin* ]]; then
  echo "capture.sh requires macOS (open command + Obsidian app)."
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
FILES=("2027-01-01" "2027-01-02" "2027-01-03" "2027-01-04" "2027-01-05")

open -a Obsidian "$VAULT_DIR"
sleep "${TD_VISUAL_BOOT_WAIT_SECS:-4}"

WINDOW_TITLE_HINT="${TD_VISUAL_WINDOW_TITLE:-${VAULT_NAME} - Obsidian}"

for file in "${FILES[@]}"; do
  open "obsidian://open?vault=${VAULT_NAME}&file=Daily%20notes%2F${file}.md"
  sleep "${TD_VISUAL_ACTION_WAIT_SECS:-2}"

  # Force a deterministic window capture for the target vault to avoid
  # accidentally grabbing tiny utility/popover windows.
  peekaboo image \
    --app Obsidian \
    --mode window \
    --window-title "$WINDOW_TITLE_HINT" \
    --path "$OUT_DIR/$file.png"

  if [[ ! -s "$OUT_DIR/$file.png" ]]; then
    echo "Failed to capture $OUT_DIR/$file.png"
    exit 1
  fi
done

echo "Visual capture complete: $OUT_DIR"
