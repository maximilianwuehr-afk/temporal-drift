// ============================================================================
// Timeline Reading View Post Processor
//
// Renders prototype-style timeline cards in Reading View (markdown preview).
// Live Preview is handled separately via CM6 widgets.
// ============================================================================

import { MarkdownPostProcessorContext, MarkdownView, TFile, normalizePath } from "obsidian";
import { pathInFolder } from "../utils/folder-match";
import type TemporalDriftPlugin from "../main";
import {
  extractMeetingJoinUrl,
  extractParticipants,
  extractPrimaryLink,
  isTimelineLine,
  parseTimelineLine,
  stripEventIdSuffix,
  stripWikilinks,
} from "../parsing/timeline";

type Participant = { target: string; display: string };

type ParsedEntry = {
  lineStart: number; // 0-based line index
  lineEnd: number; // inclusive
  time: string; // HH:mm or HH:mm–HH:mm
  head: string;
  title: string;
  locationText: string;
  participants: Participant[];
  bodyLines: string[];
  joinUrl: string | null;
};

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
    const parsed = parseTimelineLine(line);
    if (!parsed) continue;

    const time = parsed.timeText;
    const head = parsed.head;

    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (isTimelineLine(next)) break;
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

    const joinUrl = extractMeetingJoinUrl([head, ...bodyLines]);

    entries.push({
      lineStart: i,
      lineEnd: j - 1,
      time,
      head,
      title,
      locationText,
      participants,
      bodyLines,
      joinUrl,
    });

    i = j - 1;
  }

  return entries;
}

function openExternalUrl(app: TemporalDriftPlugin["app"], url: string): void {
  const openWithDefaultApp = (app as any).openWithDefaultApp as ((targetUrl: string) => void) | undefined;
  if (openWithDefaultApp) {
    openWithDefaultApp(url);
    return;
  }

  window.open(url);
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

  const joinUrl = entry.joinUrl;
  if (joinUrl) {
    const joinBtn = document.createElement("button");
    joinBtn.className = "event-join-btn";
    joinBtn.type = "button";
    joinBtn.setAttribute("aria-label", "Join meeting");
    joinBtn.setAttribute("title", "Join meeting");
    joinBtn.textContent = "Join";
    joinBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openExternalUrl(app, joinUrl);
    });
    right.appendChild(joinBtn);
  }

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

  // If we are in reading view, flip back to source so cursor is meaningful.
  if (mdView.getMode() === "preview") {
    await (app as any).commands?.executeCommandById?.("markdown:toggle-preview");
  }

  mdView.editor.setCursor({ line, ch: 0 });
  mdView.editor.focus();
}

export function registerTimelinePostProcessor(plugin: TemporalDriftPlugin): void {
  // Cache parsed entries per file mtime.
  const cache = new Map<string, { mtime: number; entries: ParsedEntry[]; byStart: Map<number, ParsedEntry> }>();

  plugin.registerMarkdownPostProcessor(
    async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const sourcePath = ctx.sourcePath;
      if (!sourcePath) return;

      const normalizedPath = normalizePath(sourcePath);
      if (!pathInFolder(normalizedPath, plugin.settings.dailyNotesFolder, ["Daily notes"])) {
        return;
      }

      const af = plugin.app.vault.getAbstractFileByPath(sourcePath);
      if (!(af instanceof TFile)) return;

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

      const ranges = cached.entries.map((e) => ({ start: e.lineStart, end: e.lineEnd }));

      const inAnyRange = (line: number): boolean => {
        for (const r of ranges) {
          if (line >= r.start && line <= r.end) return true;
        }
        return false;
      };

      // In preview mode, timeline entries may render inside list items.
      const candidates = Array.from(el.querySelectorAll("li, p"));
      const blocks = candidates.length > 0 ? candidates : Array.from(el.children);

      for (const child of blocks) {
        const info = ctx.getSectionInfo(child as HTMLElement);
        if (!info) continue;

        if (!inAnyRange(info.lineStart)) continue;

        const entry = cached.byStart.get(info.lineStart);
        if (entry) {
          const card = renderCardDom(plugin.app, af, entry);
          child.replaceWith(card);
        } else {
          // Part of timeline entry body; remove duplicate rendered lines.
          child.remove();
        }
      }
    },
    200
  );
}
