import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTaskSnapshotToTimelineLine,
  parseTaskSnapshotFromContent,
  taskLinkMatches,
} from "../../src/services/task-allocation-utils";

test("parseTaskSnapshotFromContent prefers frontmatter status + priority", () => {
  const content = `---
status: done
priority: next
done: true
---

- [ ] Ship parser`;

  const snapshot = parseTaskSnapshotFromContent(content, {
    status: "done",
    priority: "next",
    done: true,
  });

  assert.equal(snapshot.done, true);
  assert.equal(snapshot.priority, "next");
});

test("taskLinkMatches supports canonical and extension-less targets", () => {
  assert.equal(taskLinkMatches("Tasks/Ship parser.md", "Tasks/Ship parser.md"), true);
  assert.equal(taskLinkMatches("Tasks/Ship parser", "Tasks/Ship parser.md"), true);
  assert.equal(taskLinkMatches("Ship parser", "Tasks/Ship parser.md"), true);
  assert.equal(taskLinkMatches("Tasks/Another", "Tasks/Ship parser.md"), false);
});

test("applyTaskSnapshotToTimelineLine updates checkbox and priority for linked task", () => {
  const line = "10:30 — [ ] [[Tasks/Ship parser.md|Ship parser]] @later";

  const updated = applyTaskSnapshotToTimelineLine(line, "Tasks/Ship parser.md", {
    done: true,
    priority: "now",
  });

  assert.equal(updated, "10:30 — [x] [[Tasks/Ship parser.md|Ship parser]] #now");
});

test("applyTaskSnapshotToTimelineLine is no-op when linked task does not match", () => {
  const line = "10:30 — [ ] [[Tasks/Ship parser.md|Ship parser]] #next";

  const updated = applyTaskSnapshotToTimelineLine(line, "Tasks/Other task.md", {
    done: true,
    priority: "later",
  });

  assert.equal(updated, line);
});

test("applyTaskSnapshotToTimelineLine can clear priority markers", () => {
  const line = "10:30 — - [x] [[Tasks/Ship parser|Ship parser]] (later)";

  const updated = applyTaskSnapshotToTimelineLine(line, "Tasks/Ship parser.md", {
    done: false,
    priority: null,
  });

  assert.equal(updated, "10:30 — - [ ] [[Tasks/Ship parser|Ship parser]]");
});
