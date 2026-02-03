// ============================================================================
// Timeline Reading View Post Processor
//
// Renders prototype-style timeline cards in READING VIEW (markdown preview).
// Live Preview is handled separately via CM6 widgets.
//
// Strategy:
// - Parse the source markdown (by file path) into timestamp entry ranges.
// - Walk rendered DOM blocks; if a block corresponds to an entry range, replace
//   the first block with a card and remove subsequent blocks that belong to the
//   same entry.
// ============================================================================

import { MarkdownPostProcessorContext, MarkdownView, TFile, normalizePath } from "obsidian";
import type TemporalDriftPlugin from "../main";

type Participant = { target: string; display: string };

type ParsedEntry = {
  lineStart: number; // 0-based line index
  lineEnd: number; // inclusive
  time: string; // HH:mm
  head: string;
  title: string;
  locationText: string;
  participants: Participant[];
  bodyLines: string[];
};

const TIME_LINE_RE = /^\s*(?:[-*+]\s+)?(\d{2}):(\d{2})\s+(.*)$/;
const IS_TIME_LINE = (line: string) => /^\s*(?:[-*+]\s+)?\d{2}:\d{2}\s/.test(line);

function parseWikilinkDisplay(raw: string): { target: string; display: string } {
  const match = raw.match(/^([^|]+)(?:\|(.+))?$/);
  const target = (match?.[1] ?? raw).trim();
  const display = (match?.[2] ?? target.split("/").pop() ?? target).trim();
  return { target, display };
}

function stripWikilinks(text: string): string {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, p1: string, p2: string | undefined) => {
    const display = (p2 ?? p1.split("/").pop() ?? p1).trim();
    return display;
  });
}

function stripEventIdSuffix(title: string): string {
  return title.replace(/\s*~[a-zA-Z0-9]+$/, "").trim();
}

function extractPrimaryLink(head: string): { target: string; display: string } | null {
  const m = head.match(/\[\[([^\]]+)\]\]/);
  if (!m) return null;
  return parseWikilinkDisplay(m[1]);
}

function extractParticipants(head: string): Participant[] {
  const withIdx = head.indexOf(" with ");
  if (withIdx < 0) return [];
  const tail = head.slice(withIdx + " with ".length);
  const matches = Array.from(tail.matchAll(/\[\[([^\]]+)\]\]/g));
  return matches.map((m) => parseWikilinkDisplay(m[1]));
}

function getInitials(name: string): string {
  const cleaned = name.replace(/\[\[|\]\]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function parseEntriesFromMarkdown(md: string): ParsedEntry[] {
  const lines = md.split("\n");
  const entries: ParsedEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!IS_TIME_LINE(line)) continue;

    const m = line.match(TIME_LINE_RE);
    if (!m) continue;

    const time = `${m[1]}:${m[2]}`;
    const head = (m[3] ?? "").trim();

    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (IS_TIME_LINE(next)) break;
      if (next.match(/^##/)) break;

      if (next.trim() === "") {
        bodyLines.push("");
        j++;
        continue;
      }

      if (!/^\s+/.test(next)) break;

      bodyLines.push(next.replace(/^\s+/, ""));
      j++;
    }

    const primary = extractPrimaryLink(head);
    const participants = extractParticipants(head);

    const title = (() => {
      if (primary) return stripEventIdSuffix(primary.display);
      const plain = head.split(" with ")[0];
      return stripEventIdSuffix(stripWikilinks(plain || "(empty)"));
    })();

    const locationText = (() => {
      let t = head;
      t = t.replace(/^\s*\[\[[^\]]+\]\]\s*/, "");
      const withIdx = t.indexOf(" with ");
      if (withIdx >= 0) t = t.slice(0, withIdx);
      return stripWikilinks(t).trim();
    })();

    entries.push({
      lineStart: i,
      lineEnd: j - 1,
      time,
      head,
      title,
      locationText,
      participants,
      bodyLines,
    });

    i = j - 1;
  }

  return entries;
}

function renderCardDom(app: TemporalDriftPlugin["app"], file: TFile, entry: ParsedEntry): HTMLElement {
  const root = document.createElement("div");
  root.className = "td-live-preview";

  const hour = document.createElement("div");
  hour.className = "hour";

  const timeEl = document.createElement("div");
  timeEl.className = "hour-time";
  timeEl.textContent = entry.time;

  const slot = document.createElement("div");
  slot.className = "hour-slot";

  const card = document.createElement("div");
  card.className = "event";

  const top = document.createElement("div");
  top.className = "event-top";

  const left = document.createElement("div");
  const title = document.createElement("div");
  title.className = "event-title";
  title.textContent = entry.title;
  left.appendChild(title);

  if (entry.locationText) {
    const loc = document.createElement("div");
    loc.className = "event-location";
    loc.textContent = entry.locationText;
    left.appendChild(loc);
  }

  const right = document.createElement("div");
  right.className = "event-right";
  const duration = document.createElement("span");
  duration.className = "event-duration";
  duration.textContent = "";
  right.appendChild(duration);

  top.appendChild(left);
  top.appendChild(right);
  card.appendChild(top);

  if (entry.participants.length > 0) {
    const pWrap = document.createElement("div");
    pWrap.className = "event-participants";

    for (const p of entry.participants) {
      const a = document.createElement("a");
      a.className = "participant";
      a.href = "#";

      const av = document.createElement("span");
      av.className = "participant-avatar";
      av.textContent = getInitials(p.display);

      a.appendChild(av);
      a.appendChild(document.createTextNode(p.display));
      a.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await openAndJumpToLine(app, file, entry.lineStart);
      });

      pWrap.appendChild(a);
    }

    card.appendChild(pWrap);
  }

  if (entry.bodyLines.length > 0) {
    const body = document.createElement("div");
    body.className = "event-body";

    const pre = document.createElement("div");
    pre.className = "event-body-text";
    pre.textContent = entry.bodyLines
      .filter((l) => l.trim().length > 0)
      .slice(0, 6)
      .map(stripWikilinks)
      .join("\n");

    body.appendChild(pre);
    card.appendChild(body);
  }

  slot.appendChild(card);
  hour.appendChild(timeEl);
  hour.appendChild(slot);
  root.appendChild(hour);

  root.addEventListener("click", async (e) => {
    e.preventDefault();
    await openAndJumpToLine(app, file, entry.lineStart);
  });

  return root;
}

async function openAndJumpToLine(app: TemporalDriftPlugin["app"], file: TFile, line: number): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { active: true });

  const mdView = app.workspace.getActiveViewOfType(MarkdownView);
  if (!mdView) return;

  // If we are in preview (reading view), flip back to source (Live Preview) so cursor is meaningful.
  if (mdView.getMode() === "preview") {
    // toggles preview <-> source
    await app.commands.executeCommandById("markdown:toggle-preview");
  }

  mdView.editor.setCursor({ line, ch: 0 });
  mdView.editor.focus();
}

export function registerTimelinePostProcessor(plugin: TemporalDriftPlugin): void {
  // Cache parsed entries per file mtime.
  const cache = new Map<string, { mtime: number; entries: ParsedEntry[]; byStart: Map<number, ParsedEntry> }>();

  plugin.registerMarkdownPostProcessor(async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const sourcePath = ctx.sourcePath;
    if (!sourcePath) return;

    const folderPrefix = normalizePath(plugin.settings.dailyNotesFolder + "/");
    const normalizedPath = normalizePath(sourcePath);

    if (!normalizedPath.startsWith(folderPrefix)) return;

    const af = plugin.app.vault.getAbstractFileByPath(sourcePath);
    if (!(af instanceof TFile)) return;

    // Parse / cache
    const mtime = af.stat.mtime;
    let cached = cache.get(sourcePath);
    if (!cached || cached.mtime !== mtime) {
      const md = await plugin.app.vault.read(af);
      const entries = parseEntriesFromMarkdown(md);
      const byStart = new Map<number, ParsedEntry>();
      for (const e of entries) byStart.set(e.lineStart, e);
      cached = { mtime, entries, byStart };
      cache.set(sourcePath, cached);
    }

    if (cached.entries.length === 0) return;

    // Build a quick range lookup
    const ranges = cached.entries.map((e) => ({ start: e.lineStart, end: e.lineEnd }));

    const inAnyRange = (line: number): boolean => {
      for (const r of ranges) {
        if (line >= r.start && line <= r.end) return true;
      }
      return false;
    };

    // Walk candidate blocks. In preview mode, timeline entries may render inside list items,
    // so we search for li/p elements first; fallback to direct children.
    const candidates = Array.from(el.querySelectorAll("li, p"));
    const blocks = candidates.length > 0 ? candidates : Array.from(el.children);

    for (const child of blocks) {
      const info = ctx.getSectionInfo(child as HTMLElement);
      if (!info) continue;

      if (!inAnyRange(info.lineStart)) continue;

      const entry = cached.byStart.get(info.lineStart);
      if (entry) {
        // Replace this block with our card
        const card = renderCardDom(plugin.app, af, entry);
        child.replaceWith(card);
      } else {
        // This block is part of a timeline entry (likely indented body); remove it.
        child.remove();
      }
    }
  }, 200);
}
