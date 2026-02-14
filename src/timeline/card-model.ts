import {
  extractMeetingJoinUrl,
  extractParticipants,
  extractPrimaryLink,
  parseTaskHead,
  stripEventIdSuffix,
  stripWikilinks,
} from "../parsing/timeline";

export type TimelineCardKind = "event" | "task" | "note";
export type TimelineTaskPriority = "now" | "next" | "later" | null;

export interface TimelineCardParticipant {
  target: string;
  display: string;
}

export interface TimelineCardModel {
  time: string;
  kind: TimelineCardKind;
  title: string;
  locationText: string;
  participants: TimelineCardParticipant[];
  contextLines: string[];
  joinUrl: string | null;
  primaryLinkTarget: string | null;
  taskDone: boolean;
  taskPriority: TimelineTaskPriority;
  taskLinkPath: string | null;
  isNow: boolean;
  durationText: string;
}

export interface TimelineCardModelInput {
  time: string;
  head: string;
  bodyLines: string[];
}

export function parseTimeWindow(timeText: string): { start: number; end: number | null } | null {
  const start = timeText.match(/^(\d{2}):(\d{2})/);
  if (!start) return null;

  const startMinutes = Number(start[1]) * 60 + Number(start[2]);
  const end = timeText.match(/[–-](\d{2}):(\d{2})/);
  if (!end) return { start: startMinutes, end: null };

  return {
    start: startMinutes,
    end: Number(end[1]) * 60 + Number(end[2]),
  };
}

export function formatDuration(timeText: string): string {
  const window = parseTimeWindow(timeText);
  if (!window || window.end === null) return "";

  const minutes = window.end - window.start;
  if (minutes <= 0) return "";

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h`;
  return `${mins}m`;
}

export function isTimelineCardNow(timeText: string, now = new Date()): boolean {
  const window = parseTimeWindow(timeText);
  if (!window) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (window.end !== null) {
    return currentMinutes >= window.start && currentMinutes <= window.end;
  }

  return currentMinutes >= window.start && currentMinutes < window.start + 60;
}

export function buildContextLines(bodyLines: string[], joinUrl: string | null): string[] {
  const out: string[] = [];

  for (const line of bodyLines) {
    const cleaned = stripWikilinks(line.trim().replace(/^[-*+]\s+/, "").trim());
    if (!cleaned) continue;
    if (joinUrl && (cleaned.includes(joinUrl) || /^meeting link\s*:/i.test(cleaned))) continue;
    out.push(cleaned);
  }

  return out;
}

export function contextIconForLine(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("agenda") || lower.includes("next") || lower.includes("todo")) return "→";
  if (lower.includes("last") || lower.includes("follow-up") || lower.includes("follow up")) return "↺";
  if (lower.includes("link") || lower.includes("doc") || lower.includes("thread")) return "↗";
  return "◆";
}

export function createTimelineCardModel(input: TimelineCardModelInput): TimelineCardModel {
  const { time, head, bodyLines } = input;
  const task = parseTaskHead(head);
  const primary = extractPrimaryLink(head);

  const kind: TimelineCardKind = task.isTask ? "task" : primary ? "event" : "note";
  const participants = kind === "task" ? [] : extractParticipants(head);

  const title = (() => {
    if (kind === "task") {
      return stripWikilinks(task.title || "(empty task)");
    }
    if (primary) return stripEventIdSuffix(primary.display);
    const plain = head.split(" with ")[0];
    return stripEventIdSuffix(stripWikilinks(plain || "(empty)"));
  })();

  const locationText = (() => {
    if (kind !== "event") return "";

    let t = head;
    t = t.replace(/^\s*\[\[[^\]]+\]\]\s*/, "");
    if (/^with\s/i.test(t)) return "";
    const withIdx = t.search(/\swith\s/i);
    if (withIdx >= 0) t = t.slice(0, withIdx);
    return stripWikilinks(t).trim();
  })();

  const joinUrl = kind === "task" ? null : extractMeetingJoinUrl([head, ...bodyLines]);
  const contextLines = buildContextLines(bodyLines, joinUrl);

  const primaryLinkTarget = primary?.target ?? null;
  const taskLinkPath = kind === "task" ? primaryLinkTarget : null;

  return {
    time,
    kind,
    title,
    locationText,
    participants,
    contextLines,
    joinUrl,
    primaryLinkTarget,
    taskDone: kind === "task" ? task.done : false,
    taskPriority: kind === "task" ? task.priority : null,
    taskLinkPath,
    isNow: isTimelineCardNow(time),
    durationText: formatDuration(time),
  };
}
