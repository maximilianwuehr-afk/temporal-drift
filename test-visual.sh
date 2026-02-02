#!/bin/bash
# Visual regression test runner for Temporal Drift

OUT_DIR="/tmp/temporal-drift-tests"
mkdir -p "$OUT_DIR"

echo "🔍 Temporal Drift Visual Tests"
echo "=============================="

# Test files
FILES=("2027-01-01" "2027-01-02" "2027-01-03" "2027-01-04" "2027-01-05")

for file in "${FILES[@]}"; do
  echo "Testing $file..."
  open "obsidian://open?vault=wuehr&file=Daily%20notes%2F$file"
  sleep 2
  peekaboo image --app Obsidian --path "$OUT_DIR/$file.png"
  echo "  → Saved to $OUT_DIR/$file.png"
done

echo ""
echo "✅ Tests complete. Screenshots in $OUT_DIR"
echo "Open with: open $OUT_DIR"
