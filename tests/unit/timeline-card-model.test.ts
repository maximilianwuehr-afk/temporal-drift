import test from "node:test";
import assert from "node:assert/strict";
import {
  buildContextLines,
  contextIconForLine,
  createTimelineCardModel,
  formatDuration,
  isTimelineCardNow,
} from "../../src/timeline/card-model";

test("createTimelineCardModel maps event headline/body into shared model", () => {
  const model = createTimelineCardModel({
    time: "09:00",
    head: "[[FINN & BlackRock ~abc123]] @ HPS Offices with [[Dimitrios]], [[Simon]], [[Valerie]]",
    bodyLines: [
      "BRIEFING BlackRock completed HPS acquisition",
      "Agenda: confirm sequence",
      "Meeting link: https://meet.google.com/abc-defg-hij",
    ],
  });

  assert.equal(model.kind, "event");
  assert.equal(model.title, "FINN & BlackRock");
  assert.equal(model.locationText, "@ HPS Offices");
  assert.equal(model.primaryLinkTarget, "FINN & BlackRock ~abc123");
  assert.equal(model.participants.length, 3);
  assert.equal(model.joinUrl, "https://meet.google.com/abc-defg-hij");
  assert.deepEqual(model.contextLines, [
    "BRIEFING BlackRock completed HPS acquisition",
    "Agenda: confirm sequence",
  ]);
});

test("createTimelineCardModel maps task metadata and linked task path", () => {
  const model = createTimelineCardModel({
    time: "14:30",
    head: "- [x] [[Tasks/Resolve duplicate flights|Resolve duplicate flights]] #now",
    bodyLines: ["owner: maxi"],
  });

  assert.equal(model.kind, "task");
  assert.equal(model.taskDone, true);
  assert.equal(model.taskPriority, "now");
  assert.equal(model.primaryLinkTarget, "Tasks/Resolve duplicate flights");
  assert.equal(model.taskLinkPath, "Tasks/Resolve duplicate flights");
  assert.equal(model.title, "Resolve duplicate flights");
  assert.equal(model.joinUrl, null);
});

test("shared time helpers behave deterministically", () => {
  assert.equal(formatDuration("09:00–10:30"), "1h 30m");
  assert.equal(formatDuration("09:00"), "");

  const now = new Date("2026-02-14T09:15:00");
  assert.equal(isTimelineCardNow("09:00", now), true);
  assert.equal(isTimelineCardNow("10:00", now), false);
  assert.equal(isTimelineCardNow("09:00–09:30", now), true);
  assert.equal(isTimelineCardNow("08:00–08:30", now), false);
});

test("context line helpers filter join-link noise and classify icons", () => {
  const lines = buildContextLines(
    [
      "Agenda: align next steps",
      "Meeting link: https://zoom.us/j/123456",
      "Follow-up from last week",
      "Thread in docs",
    ],
    "https://zoom.us/j/123456"
  );

  assert.deepEqual(lines, ["Agenda: align next steps", "Follow-up from last week", "Thread in docs"]);
  assert.equal(contextIconForLine(lines[0]), "→");
  assert.equal(contextIconForLine(lines[1]), "↺");
  assert.equal(contextIconForLine(lines[2]), "↗");
});
