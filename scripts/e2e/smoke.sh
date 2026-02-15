#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VAULT_DIR="${TD_TEST_VAULT:-$ROOT_DIR/tests/fixtures/vault}"
PLUGIN_ID="${TD_PLUGIN_ID:-temporal-drift}"
PLUGIN_DIR="$VAULT_DIR/.obsidian/plugins/$PLUGIN_ID"
THEME_NAME="${TD_THEME_NAME:-Temporal Drift}"
THEME_SRC_DIR="$ROOT_DIR/themes/$THEME_NAME"
THEME_DIR="$VAULT_DIR/.obsidian/themes/$THEME_NAME"
APPEARANCE_FILE="$VAULT_DIR/.obsidian/appearance.json"
REPORT_DIR="${TD_REPORT_DIR:-/tmp/temporal-drift-tests}"
SMOKE_DIR="$REPORT_DIR/smoke"
SMOKE_SHOT="$SMOKE_DIR/smoke-open.png"

mkdir -p "$PLUGIN_DIR" "$SMOKE_DIR"

if [[ "$OSTYPE" != darwin* ]]; then
  echo "smoke.sh requires macOS (open command + Obsidian app)."
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

if [[ -d "$THEME_SRC_DIR" ]]; then
  mkdir -p "$THEME_DIR"
  cp "$THEME_SRC_DIR/theme.css" "$THEME_DIR/theme.css"
  cp "$THEME_SRC_DIR/manifest.json" "$THEME_DIR/manifest.json"

  if [[ -f "$APPEARANCE_FILE" ]]; then
    tmp="$(mktemp)"
    jq --arg theme "$THEME_NAME" '.cssTheme = $theme' "$APPEARANCE_FILE" > "$tmp"
    mv "$tmp" "$APPEARANCE_FILE"
  else
    printf '{\n  "cssTheme": "%s"\n}\n' "$THEME_NAME" > "$APPEARANCE_FILE"
  fi
fi

# Ensure the newly copied plugin build is actually loaded.
peekaboo app relaunch Obsidian --wait 1 --wait-until-ready --json >/dev/null

VAULT_NAME="$(basename "$VAULT_DIR")"
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

  for _ in $(seq 1 "${TD_SMOKE_OPEN_RETRIES:-20}"); do
    sleep "${TD_SMOKE_ACTION_WAIT_SECS:-1}"
    title="$(get_vault_title)"
    if [[ -n "$title" && "$title" == *"$expected_token"* ]]; then
      return 0
    fi
  done

  local stem
  stem="$(basename "$raw_path" .md)"
  open "obsidian://open?vault=${VAULT_PARAM}&file=${stem}.md"
  for _ in $(seq 1 "${TD_SMOKE_OPEN_RETRIES:-20}"); do
    sleep "${TD_SMOKE_ACTION_WAIT_SECS:-1}"
    title="$(get_vault_title)"
    if [[ -n "$title" && "$title" == *"$expected_token"* ]]; then
      return 0
    fi
  done

  open "obsidian://open?vault=${VAULT_PARAM}&file=${stem}"
  for _ in $(seq 1 "${TD_SMOKE_OPEN_RETRIES:-20}"); do
    sleep "${TD_SMOKE_ACTION_WAIT_SECS:-1}"
    title="$(get_vault_title)"
    if [[ -n "$title" && "$title" == *"$expected_token"* ]]; then
      return 0
    fi
  done

  echo "Failed to open '${raw_path}'. Vault window title: ${title:-<none>}"
  exit 1
}

open -a Obsidian "$VAULT_DIR"
sleep "${TD_SMOKE_BOOT_WAIT_SECS:-4}"

# Integration smoke: task-note snapshot -> timeline allocation rewrite
# (deterministic file-level integration path; watcher wiring is validated elsewhere)
TASK_DIR="$VAULT_DIR/Tasks"
TASK_FILE="$TASK_DIR/Smoke Sync Task.md"
DAILY_FILE="$VAULT_DIR/Daily notes/2027-01-06.md"
mkdir -p "$TASK_DIR"

cat > "$TASK_FILE" <<'EOF'
- [x] Smoke Sync Task #now
EOF

cat > "$DAILY_FILE" <<'EOF'
# 2027-01-06

## Thankful for
Stable automation.

## Focus
Verify reverse task sync.

10:30 — [ ] [[Tasks/Smoke Sync Task|Smoke Sync Task]] #later
EOF

SMOKE_SYNC_SCRIPT="$ROOT_DIR/scripts/e2e/.reverse-sync-smoke.tmp.ts"
cat > "$SMOKE_SYNC_SCRIPT" <<'TS'
import fs from "node:fs";
import { applyTaskSnapshotToTimelineLine, parseTaskSnapshotFromContent } from "../../src/services/task-allocation-utils.ts";

const taskFile = process.env.TASK_FILE;
const dailyFile = process.env.DAILY_FILE;
if (!taskFile || !dailyFile) {
  throw new Error("TASK_FILE/DAILY_FILE env missing");
}

const taskContent = fs.readFileSync(taskFile, "utf8");
const snapshot = parseTaskSnapshotFromContent(taskContent);

const lines = fs.readFileSync(dailyFile, "utf8").split("\n");
const next = lines.map((line) => applyTaskSnapshotToTimelineLine(line, "Tasks/Smoke Sync Task.md", snapshot));
fs.writeFileSync(dailyFile, next.join("\n"));
TS

TASK_FILE="$TASK_FILE" DAILY_FILE="$DAILY_FILE" npx tsx "$SMOKE_SYNC_SCRIPT"
rm -f "$SMOKE_SYNC_SCRIPT"

if ! rg -q '^10:30 — \[x\] \[\[Tasks/Smoke Sync Task\|Smoke Sync Task\]\] #now$' "$DAILY_FILE"; then
  echo "Reverse sync integration assertion failed."
  echo "--- Daily note content ---"
  cat "$DAILY_FILE"
  exit 1
fi

open_note "Daily notes/2027-01-03.md" "2027-01-03"

WINDOW_ID="$(peekaboo window list --app Obsidian --json | jq -r '.data.windows[] | select((.window_title // "") | contains("2027-01-03")) | .window_id' | head -n1)"
if [[ -z "${WINDOW_ID:-}" ]]; then
  echo "Failed to resolve window id for smoke note"
  exit 1
fi

peekaboo image \
  --app Obsidian \
  --mode window \
  --window-id "$WINDOW_ID" \
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
  "reverseSync": "pass",
  "status": "pass"
}
EOF

echo "Smoke test passed (including reverse sync). Screenshot: $SMOKE_SHOT"
