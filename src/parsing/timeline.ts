// ============================================================================
// Timeline parsing helpers (shared)
// ============================================================================

export type EntryType = "event" | "task" | "note";

export interface TimelineEntry {
  type: EntryType;
  time: string; // HH:mm or HH:mm–HH:mm
  head: string; // content on the time line
  body: string[]; // following indented lines (without leading indentation)
  lineNo: number; // 0-based index in file
}

export interface ParsedDailyTimeline {
  thankful?: string;
  focus?: string;
  entries: TimelineEntry[];
}

export interface ParsedTimelineLine {
  timeText: string;
  head: string;
  headRaw: string;
  headStart: number; // character index (within line) where head begins
}

export interface ParsedTaskHead {
  isTask: boolean;
  done: boolean;
  title: string;
  priority: "now" | "next" | "later" | null;
}

// Supported formats:
// 1) 13:00 [[Meeting]] with [[Person]]
// 2) `13:00` — [[Meeting]] with [[Person]]
// 3) 06:00–21:00 — Description
// 4) 09:00 — Description _(note)_
const TIME_PLAIN_RE = /^\s*(?:[-*+]\s+)?(\d{2}):(\d{2})\s+(.*)$/;
const TIME_DASH_RE =
  /^\s*(?:[-*+]\s+)?`?(\d{2}:\d{2})(?:\s*[–-]\s*(\d{2}:\d{2}))?`?\s*[—–-]\s*(.*)$/;

export function parseTimelineLine(text: string): ParsedTimelineLine | null {
  const dash = text.match(TIME_DASH_RE);
  if (dash) {
    const full = dash[0];
    const start = dash[1];
    const end = dash[2];
    const headRaw = dash[3] ?? "";
    const timeText = end ? `${start}–${end}` : start;
    const headStart = (dash.index ?? 0) + full.length - headRaw.length;
    return { timeText, head: headRaw.trim(), headRaw, headStart };
  }

  const plain = text.match(TIME_PLAIN_RE);
  if (plain) {
    const full = plain[0];
    const timeText = `${plain[1]}:${plain[2]}`;
    const headRaw = plain[3] ?? "";
    const headStart = (plain.index ?? 0) + full.length - headRaw.length;
    return { timeText, head: headRaw.trim(), headRaw, headStart };
  }

  return null;
}

export function isTimelineLine(text: string): boolean {
  return !!parseTimelineLine(text);
}

export function parseWikilinkDisplay(raw: string): { target: string; display: string } {
  const match = raw.match(/^([^|]+)(?:\|(.+))?$/);
  const target = (match?.[1] ?? raw).trim();
  const display = (match?.[2] ?? target.split("/").pop() ?? target).trim();
  return { target, display };
}

export function stripWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p1: string, p2: string | undefined) => {
    const display = (p2 ?? p1.split("/").pop() ?? p1).trim();
    return display;
  });
}

export function stripEventIdSuffix(title: string): string {
  return title.replace(/\s*~[a-zA-Z0-9]+$/, "").trim();
}

export function extractParticipants(head: string): Array<{ target: string; display: string }> {
  const withIdx = head.indexOf(" with ");
  if (withIdx < 0) return [];

  const tail = head.slice(withIdx + " with ".length);
  const matches = Array.from(tail.matchAll(/\[\[([^\]]+)\]\]/g));
  return matches.map((m) => parseWikilinkDisplay(m[1]));
}

export function extractPrimaryLink(head: string): { target: string; display: string } | null {
  const m = head.match(/\[\[([^\]]+)\]\]/);
  if (!m) return null;
  return parseWikilinkDisplay(m[1]);
}

export function parseTaskHead(head: string): ParsedTaskHead {
  const m = head.match(/^-?\s*\[\s*([xX ]?)\s*\]\s*(.*)$/);
  if (!m) {
    return { isTask: false, done: false, title: head.trim(), priority: null };
  }

  let title = (m[2] ?? "").trim();
  let priority: "now" | "next" | "later" | null = null;

  const priorityPatterns: Array<{ kind: "now" | "next" | "later"; re: RegExp }> = [
    { kind: "now", re: /(?:^|\s)(?:#now|@now|\[now\]|\(now\))(?:\s|$)/i },
    { kind: "next", re: /(?:^|\s)(?:#next|@next|\[next\]|\(next\))(?:\s|$)/i },
    { kind: "later", re: /(?:^|\s)(?:#later|@later|\[later\]|\(later\))(?:\s|$)/i },
  ];

  for (const p of priorityPatterns) {
    if (p.re.test(title)) {
      priority = p.kind;
      title = title.replace(p.re, " ").replace(/\s{2,}/g, " ").trim();
      break;
    }
  }

  return {
    isTask: true,
    done: (m[1] ?? "").toLowerCase() === "x",
    title,
    priority,
  };
}

export function minutesSinceMidnight(hhmm: string): number {
  // Accept single time and ranges (use start time for ranges)
  const m = hhmm.match(/(\d{2}):(\d{2})/);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function parseDailyNoteTimeline(content: string): ParsedDailyTimeline {
  const lines = content.split("\n");
  const entries: TimelineEntry[] = [];

  let inThankful = false;
  let inFocus = false;
  const thankfulLines: string[] = [];
  const focusLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^##\s*(Thankful|Grateful)/i)) {
      inThankful = true;
      inFocus = false;
      continue;
    }
    if (line.match(/^##\s*Focus/i)) {
      inThankful = false;
      inFocus = true;
      continue;
    }
    if (line.match(/^##/)) {
      inThankful = false;
      inFocus = false;
      continue;
    }

    if (isTimelineLine(line)) {
      inThankful = false;
      inFocus = false;
    }

    if (inThankful) {
      if (line.trim()) thankfulLines.push(line.trim());
      continue;
    }
    if (inFocus) {
      if (line.trim()) focusLines.push(line.trim());
      continue;
    }

    const parsedLine = parseTimelineLine(line);
    if (!parsedLine) continue;

    const time = parsedLine.timeText;
    const head = parsedLine.head;

    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (isTimelineLine(next)) break;
      if (next.match(/^##/)) break;

      if (next.trim() === "") {
        body.push("");
        j++;
        continue;
      }
      if (!/^(\s+|[-*+]\s)/.test(next)) {
        break;
      }

      body.push(next.replace(/^\s+/, ""));
      j++;
    }

    let type: EntryType = "note";
    if (head.match(/^\[\[[^\]]+\]\]/)) type = "event";
    if (parseTaskHead(head).isTask) type = "task";

    entries.push({ type, time, head, body, lineNo: i });
    i = j - 1;
  }

  return {
    thankful: thankfulLines.length ? thankfulLines.join("\n") : undefined,
    focus: focusLines.length ? focusLines.join("\n") : undefined,
    entries,
  };
}
