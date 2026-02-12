import test from "node:test";
import assert from "node:assert/strict";
import {
  extractEventIdFromHead,
  extractMeetingJoinUrl,
  extractParticipants,
  extractPrimaryLink,
  extractUrlsFromText,
  isTimelineLine,
  minutesSinceMidnight,
  parseDailyNoteTimeline,
  parseTaskHead,
  parseTimelineLine,
  parseWikilinkDisplay,
  replaceTimeToken,
  stripEventIdSuffix,
  stripWikilinks,
} from "../../src/parsing/timeline";

test("parseWikilinkDisplay handles explicit label", () => {
  const parsed = parseWikilinkDisplay("People/Sarah Chen|Sarah");
  assert.equal(parsed.target, "People/Sarah Chen");
  assert.equal(parsed.display, "Sarah");
});

test("stripWikilinks removes wiki syntax", () => {
  const text = stripWikilinks("Follow up with [[People/Sarah Chen|Sarah]] and [[Tom Schmidt]].");
  assert.equal(text, "Follow up with Sarah and Tom Schmidt.");
});

test("extractPrimaryLink and participants parse event headline", () => {
  const head = "[[Standup ~abc123]] with [[Anna Meyer]], [[Tom Schmidt]]";
  const primary = extractPrimaryLink(head);
  const participants = extractParticipants(head);

  assert.ok(primary);
  assert.equal(primary?.target, "Standup ~abc123");
  assert.equal(primary?.display, "Standup ~abc123");
  assert.equal(participants.length, 2);
  assert.equal(participants[0].display, "Anna Meyer");
  assert.equal(participants[1].target, "Tom Schmidt");
});

test("stripEventIdSuffix removes trailing event ids", () => {
  assert.equal(stripEventIdSuffix("Standup ~abc123"), "Standup");
  assert.equal(stripEventIdSuffix("Standup ~abc_123@google.com"), "Standup");
  assert.equal(stripEventIdSuffix("Normal title"), "Normal title");
});

test("extractEventIdFromHead extracts id from primary wikilink", () => {
  const head = "[[Weekly Sync ~abc_123@google.com]] with [[Alice]]";
  assert.equal(extractEventIdFromHead(head), "abc_123@google.com");
});

test("replaceTimeToken patches only first HH:mm occurrence", () => {
  const line = "09:00 [[Weekly Sync ~abc123]] with [[Alice]]";
  assert.equal(replaceTimeToken(line, "09:30"), "09:30 [[Weekly Sync ~abc123]] with [[Alice]]");
});

test("extractUrlsFromText parses plain and markdown links", () => {
  const text = "Join: https://meet.google.com/abc-defg-hij and [backup](https://zoom.us/j/123456789).";
  const urls = extractUrlsFromText(text);

  assert.deepEqual(urls, ["https://meet.google.com/abc-defg-hij", "https://zoom.us/j/123456789"]);
});

test("extractMeetingJoinUrl prefers known meeting hosts", () => {
  const url = extractMeetingJoinUrl([
    "Agenda: https://docs.google.com/document/d/abc",
    "Join here https://finn.zoom.us/j/123456789?pwd=abc",
  ]);

  assert.equal(url, "https://finn.zoom.us/j/123456789?pwd=abc");
});

test("extractMeetingJoinUrl falls back to single unknown url", () => {
  const url = extractMeetingJoinUrl("Dial-in: https://calls.finn.internal/room/ops-sync");
  assert.equal(url, "https://calls.finn.internal/room/ops-sync");
});

test("minutesSinceMidnight parses valid hh:mm", () => {
  assert.equal(minutesSinceMidnight("09:30"), 570);
  assert.equal(minutesSinceMidnight("06:00–21:00"), 360);
  assert.equal(Number.isNaN(minutesSinceMidnight("bad")), true);
});

test("parseTimelineLine supports canonical and legacy formats", () => {
  assert.equal(parseTimelineLine("13:00 [[Standup]]")?.timeText, "13:00");
  assert.equal(parseTimelineLine("`13:00` — [[Standup]]")?.timeText, "13:00");
  assert.equal(parseTimelineLine("06:00–21:00 — Workday")?.timeText, "06:00–21:00");
  assert.equal(parseTimelineLine("09:00 - Something")?.head, "Something");
  assert.equal(isTimelineLine("not a timeline line"), false);
});

test("parseTaskHead handles open/done task heads", () => {
  const openTask = parseTaskHead("[ ] Ship parser #now");
  const doneTask = parseTaskHead("- [x] Review notes @later");
  const plain = parseTaskHead("Plain note");

  assert.equal(openTask.isTask, true);
  assert.equal(openTask.done, false);
  assert.equal(openTask.title, "Ship parser");
  assert.equal(openTask.priority, "now");

  assert.equal(doneTask.isTask, true);
  assert.equal(doneTask.done, true);
  assert.equal(doneTask.title, "Review notes");
  assert.equal(doneTask.priority, "later");

  assert.equal(plain.isTask, false);
  assert.equal(plain.priority, null);
});

test("parseDailyNoteTimeline parses sections and entries", () => {
  const content = `# 2027-01-01

## Thankful for
Family

## Focus
Ship prototype

09:00 [[Standup ~id123]] with [[Anna Meyer]], [[Tom Schmidt]]
      Agenda item 1
      Agenda item 2

10:30 - [ ] [[Write release notes]]
11:15 Capture findings`;

  const parsed = parseDailyNoteTimeline(content);

  assert.equal(parsed.thankful, "Family");
  assert.equal(parsed.focus, "Ship prototype");
  assert.equal(parsed.entries.length, 3);

  assert.equal(parsed.entries[0].type, "event");
  assert.equal(parsed.entries[0].time, "09:00");
  assert.deepEqual(parsed.entries[0].body, ["Agenda item 1", "Agenda item 2", ""]);

  assert.equal(parsed.entries[1].type, "task");
  assert.equal(parsed.entries[1].time, "10:30");

  assert.equal(parsed.entries[2].type, "note");
  assert.equal(parsed.entries[2].head, "Capture findings");
});

test("parseDailyNoteTimeline handles dash/backtick/range and indented children", () => {
  const content = `# 2027-01-02

\`13:00\` — [[Board Sync ~id999]] with [[Bülent Bayram]]
    Context line 1
    Context line 2
    https://example.com

06:00–21:00 — Workday
09:00 — Freeform note _(legacy)_`;

  const parsed = parseDailyNoteTimeline(content);
  assert.equal(parsed.entries.length, 3);
  assert.equal(parsed.entries[0].time, "13:00");
  assert.equal(parsed.entries[0].body.length, 4); // 3 lines + blank separator
  assert.equal(parsed.entries[1].time, "06:00–21:00");
  assert.equal(parsed.entries[1].head, "Workday");
  assert.equal(parsed.entries[2].head, "Freeform note _(legacy)_");
});

test("parseDailyNoteTimeline handles empty daily note", () => {
  const parsed = parseDailyNoteTimeline("");
  assert.equal(parsed.entries.length, 0);
  assert.equal(parsed.thankful, undefined);
  assert.equal(parsed.focus, undefined);
});

test("parseDailyNoteTimeline handles note without timestamp entries", () => {
  const content = `# 2027-01-03

## Focus
Ship parser

This is plain prose without timestamps.
- and a bullet point`;

  const parsed = parseDailyNoteTimeline(content);
  assert.equal(parsed.entries.length, 0);
  assert.ok(parsed.focus?.includes("Ship parser"));
});
