#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VAULT_DIR="${TD_TEST_VAULT:-$ROOT_DIR/tests/fixtures/vault}"
PLUGIN_ID="${TD_PLUGIN_ID:-temporal-drift}"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/$PLUGIN_ID"
REPORT_DIR="${TD_REPORT_DIR:-/tmp/temporal-drift-tests}"
OUT_DIR="$REPORT_DIR/current"

mkdir -p "$OUT_DIR" "$PLUGIN_DIR"
rm -f "$OUT_DIR"/*.png

if [[ "$OSTYPE" != darwin* ]]; then
  echo "capture.sh requires macOS (open command + Obsidian app)."
  exit 1
fi

for cmd in open peekaboo jq python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

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

# Ensure the newly copied plugin build is actually loaded.
peekaboo app relaunch Obsidian --wait 1 --wait-until-ready --json >/dev/null

VAULT_NAME="$(basename "$VAULT_DIR")"
FILES=("2027-01-01" "2027-01-02" "2027-01-03" "2027-01-04" "2027-01-05")
OBSIDIAN_CONFIG="$HOME/Library/Application Support/obsidian/obsidian.json"
VAULT_PARAM="$VAULT_NAME"
if [[ -f "$OBSIDIAN_CONFIG" ]]; then
  VAULT_REALPATH="$(cd "$VAULT_DIR" && pwd)"
  VAULT_ID="$(jq -r --arg p "$VAULT_REALPATH" '.vaults | to_entries[] | select(.value.path == $p) | .key' "$OBSIDIAN_CONFIG" | head -n1)"
  if [[ -n "${VAULT_ID:-}" ]]; then
    VAULT_PARAM="$VAULT_ID"
  fi
fi

get_vault_title() {
  peekaboo window list --app Obsidian --json \
    | jq -r --arg needle " - ${VAULT_NAME} - Obsidian" '.data.windows[]?.window_title // empty | select(contains($needle))' \
    | head -n1
}

url_encode() {
  python3 - "$1" <<'PY'
import sys, urllib.parse
print(urllib.parse.quote(sys.argv[1], safe=""))
PY
}

open_note() {
  local raw_path="$1"
  local expected_token="$2"
  local title=""
  local encoded_path
  encoded_path="$(url_encode "$raw_path")"

  open "obsidian://open?vault=${VAULT_PARAM}&file=${encoded_path}"

  for _ in $(seq 1 "${TD_VISUAL_OPEN_RETRIES:-20}"); do
    sleep "${TD_VISUAL_ACTION_WAIT_SECS:-1}"
    title="$(get_vault_title)"
    if [[ -n "$title" && "$title" == *"$expected_token"* ]]; then
      return 0
    fi
  done

  # Fallback by basename if path-based open fails on a specific vault setup.
  local stem
  stem="$(basename "$raw_path" .md)"
  open "obsidian://open?vault=${VAULT_PARAM}&file=${stem}.md"
  for _ in $(seq 1 "${TD_VISUAL_OPEN_RETRIES:-20}"); do
    sleep "${TD_VISUAL_ACTION_WAIT_SECS:-1}"
    title="$(get_vault_title)"
    if [[ -n "$title" && "$title" == *"$expected_token"* ]]; then
      return 0
    fi
  done

  open "obsidian://open?vault=${VAULT_PARAM}&file=${stem}"
  for _ in $(seq 1 "${TD_VISUAL_OPEN_RETRIES:-20}"); do
    sleep "${TD_VISUAL_ACTION_WAIT_SECS:-1}"
    title="$(get_vault_title)"
    if [[ -n "$title" && "$title" == *"$expected_token"* ]]; then
      return 0
    fi
  done

  echo "Failed to open '${raw_path}'. Vault window title: ${title:-<none>}"
  exit 1
}

open -a Obsidian "$VAULT_DIR"
sleep "${TD_VISUAL_BOOT_WAIT_SECS:-4}"

# Preflight: verify URI open works for this vault identifier.
open_note "README.md" "README"

for file in "${FILES[@]}"; do
  open_note "Daily notes/${file}.md" "$file"

  WINDOW_ID="$(peekaboo window list --app Obsidian --json | jq -r --arg token "$file" '.data.windows[] | select((.window_title // "") | contains($token)) | .window_id' | head -n1)"
  if [[ -z "${WINDOW_ID:-}" ]]; then
    echo "Failed to resolve window id for note $file"
    exit 1
  fi

  peekaboo image \
    --app Obsidian \
    --mode window \
    --window-id "$WINDOW_ID" \
    --path "$OUT_DIR/$file.png"

  if [[ ! -s "$OUT_DIR/$file.png" ]]; then
    echo "Failed to capture $OUT_DIR/$file.png"
    exit 1
  fi
done

echo "Visual capture complete: $OUT_DIR"
