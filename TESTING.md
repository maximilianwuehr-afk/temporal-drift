# Temporal Drift Testing

## Peekaboo Visual Testing

**Note:** Peekaboo permissions are granted to Maxi's terminal. Run tests from there.

### Quick Test Commands

```bash
# Capture current Obsidian state
peekaboo see --app Obsidian --annotate --path /tmp/td-test.png

# Open test daily note
open "obsidian://open?vault=wuehr&file=Daily%20notes%2F2027-01-01"

# Capture after navigation
sleep 2 && peekaboo image --app Obsidian --path /tmp/td-timeline.png
```

### Test Scenarios

| ID | File | What to Check |
|----|------|---------------|
| T1 | 2027-01-01.md | Base rendering: timestamps amber, content readable |
| T2 | 2027-01-02.md | Minimal: clean layout with few entries |
| T3 | 2027-01-03.md | Dense: performance with 20+ entries |
| T4 | 2027-01-04.md | Edge cases: malformed times, unicode |
| T5 | 2027-01-05.md | Real data: historical calendar events |

### Acceptance Criteria (Phase 1)

- [ ] Timestamps (`HH:mm`) render in amber monospace
- [ ] Content renders in sans-serif
- [ ] Current time block has left border accent
- [ ] Enter at end of entry inserts new timestamp
- [ ] No performance lag on scroll
- [ ] Dark mode colors work

### Running Tests

```bash
# Full test run
cd ~/Workspace/obsidian_plugins/temporal-drift
./test-visual.sh
```
