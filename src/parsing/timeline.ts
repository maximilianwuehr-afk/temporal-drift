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

// Supported formats (top-level only, no leading indentation):
// 1) 13:00 [[Meeting]] with [[Person]]
// 2) `13:00` — [[Meeting]] with [[Person]]
// 3) 06:00–21:00 — Description
// 4) 09:00 — Description _(note)_
// Also accepts single-digit hours and "." as separator (e.g., 9.30),
// normalizing to HH:mm in parser output.
const TIME_PLAIN_RE = /^(?:[-*+]\s+)?(\d{1,2}[:.]\d{2})\s+(.*)$/;
const TIME_DASH_RE =
  /^(?:[-*+]\s+)?`?(\d{1,2}[:.]\d{2})(?:\s*[–-]\s*(\d{1,2}[:.]\d{2}))?`?\s*[—–-]\s*(.*)$/;

function normalizeTimeToken(raw: string): string | null {
  const m = raw.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function parseTimelineLine(text: string): ParsedTimelineLine | null {
  const dash = text.match(TIME_DASH_RE);
  if (dash) {
    const full = dash[0];
    const start = normalizeTimeToken(dash[1] ?? "");
    const end = dash[2] ? normalizeTimeToken(dash[2]) : null;
    if (!start) return null;
    if (dash[2] && !end) return null;
    const headRaw = dash[3] ?? "";
    const timeText = end ? `${start}–${end}` : start;
    const headStart = (dash.index ?? 0) + full.length - headRaw.length;
    return { timeText, head: headRaw.trim(), headRaw, headStart };
  }

  const plain = text.match(TIME_PLAIN_RE);
  if (plain) {
    const full = plain[0];
    const timeText = normalizeTimeToken(plain[1] ?? "");
    if (!timeText) return null;
    const headRaw = plain[2] ?? "";
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
  return title.replace(/\s*~[^\s\]|]+$/, "").trim();
}

export function extractEventIdFromHead(head: string): string | null {
  const primary = extractPrimaryLink(head);
  if (!primary) return null;

  const fromTarget = primary.target.match(/~([^\s\]|]+)$/);
  if (fromTarget?.[1]) return fromTarget[1];

  const fromDisplay = primary.display.match(/~([^\s\]|]+)$/);
  if (fromDisplay?.[1]) return fromDisplay[1];

  return null;
}

export function replaceTimeToken(line: string, nextTime: string): string {
  const idx = line.search(/\d{1,2}[:.]\d{2}/);
  if (idx < 0) return line;
  const token = line.slice(idx).match(/^\d{1,2}[:.]\d{2}/)?.[0];
  if (!token) return line;
  return `${line.slice(0, idx)}${nextTime}${line.slice(idx + token.length)}`;
}

const URL_RE = /https?:\/\/[^\s<>"]+/gi;

const KNOWN_MEETING_HOSTS = [
  "meet.google.com",
  "zoom.us",
  "teams.microsoft.com",
  "webex.com",
  "whereby.com",
  "around.co",
  "chime.aws",
];

function trimUrlCandidate(raw: string): string {
  let url = raw.trim();

  // Strip wrapping markdown punctuation and obvious trailing prose punctuation.
  while (/^[<(\[]/.test(url)) url = url.slice(1);
  while (/[\]>.,;!?]$/.test(url)) url = url.slice(0, -1);

  // Handle unmatched trailing ")" from markdown links.
  while (url.endsWith(")")) {
    const opens = (url.match(/\(/g) || []).length;
    const closes = (url.match(/\)/g) || []).length;
    if (closes <= opens) break;
    url = url.slice(0, -1);
  }

  return url;
}

function meetingUrlScore(url: string): number {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 0;
  }

  const host = parsed.hostname.toLowerCase();
  if (KNOWN_MEETING_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) {
    return 100;
  }

  const body = `${host}${parsed.pathname}${parsed.search}`.toLowerCase();
  if (/(join|meeting|meet|conference|call)/.test(body)) {
    return 60;
  }

  return 10;
}

export function extractUrlsFromText(text: string): string[] {
  const matches = Array.from(text.matchAll(URL_RE));
  const out: string[] = [];

  for (const m of matches) {
    const candidate = trimUrlCandidate(m[0] ?? "");
    if (!candidate) continue;
    if (!out.includes(candidate)) out.push(candidate);
  }

  return out;
}

export function extractMeetingJoinUrl(input: string | string[]): string | null {
  const lines = Array.isArray(input) ? input : [input];
  const urls = lines.flatMap((line) => extractUrlsFromText(line));
  if (urls.length === 0) return null;

  const scored = urls
    .map((url, idx) => ({ url, score: meetingUrlScore(url), idx }))
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  if (scored[0].score >= 20) return scored[0].url;

  // Fallback: if there's only one link, assume that's the intended join target.
  if (urls.length === 1) return urls[0];

  return null;
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
  const m = hhmm.match(/(\d{1,2})[:.](\d{2})/);
  if (!m) return Number.NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return Number.NaN;
  return hh * 60 + mm;
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
