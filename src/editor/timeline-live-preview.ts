// ============================================================================
// Timeline Live Preview (CodeMirror 6)
//
// Replaces timestamp blocks in Obsidian Live Preview with rich, prototype-style
// cards (markdown-first: underlying text remains valid markdown).
// ============================================================================

import { Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { editorInfoField, editorLivePreviewField, normalizePath } from "obsidian";
import { TemporalDriftSettings } from "../types";

type Participant = { target: string; display: string };

type TimelineEntry = {
  from: number;
  to: number;
  lineFrom: number;
  time: string;
  title: string;
  locationText: string;
  participants: Participant[];
  bodyLines: string[];
  raw: string;
};

const TIME_LINE_RE = /^(\d{2}):(\d{2})\s+(.*)$/;
const IS_TIME_LINE = (text: string) => /^\d{2}:\d{2}\s/.test(text);

function stripEventIdSuffix(title: string): string {
  return title.replace(/\s*~[a-zA-Z0-9]+$/, "").trim();
}

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

class TimelineCardWidget extends WidgetType {
  constructor(private entry: TimelineEntry) {
    super();
  }

  eq(other: TimelineCardWidget): boolean {
    return this.entry.raw === other.entry.raw;
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "td-live-preview";

    const hour = document.createElement("div");
    hour.className = "hour";

    const timeEl = document.createElement("div");
    timeEl.className = "hour-time";
    timeEl.textContent = this.entry.time;

    const slot = document.createElement("div");
    slot.className = "hour-slot";

    const card = document.createElement("div");
    card.className = "event";

    const top = document.createElement("div");
    top.className = "event-top";

    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "event-title";
    title.textContent = this.entry.title;
    left.appendChild(title);

    if (this.entry.locationText) {
      const loc = document.createElement("div");
      loc.className = "event-location";
      loc.textContent = this.entry.locationText;
      left.appendChild(loc);
    }

    const right = document.createElement("div");
    right.className = "event-right";
    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    if (this.entry.participants.length > 0) {
      const pWrap = document.createElement("div");
      pWrap.className = "event-participants";

      for (const p of this.entry.participants) {
        const a = document.createElement("a");
        a.className = "participant";
        a.href = "#";

        const av = document.createElement("span");
        av.className = "participant-avatar";
        av.textContent = getInitials(p.display);

        a.appendChild(av);
        a.appendChild(document.createTextNode(p.display));

        a.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          view.dispatch({ selection: { anchor: this.entry.lineFrom } });
          view.focus();
        });

        pWrap.appendChild(a);
      }
      card.appendChild(pWrap);
    }

    if (this.entry.bodyLines.length > 0) {
      const body = document.createElement("div");
      body.className = "event-body";
      const pre = document.createElement("div");
      pre.className = "event-body-text";
      pre.textContent = this.entry.bodyLines
        .filter((l) => l.trim().length > 0)
        .slice(0, 3)
        .map(stripWikilinks)
        .join("\n");
      body.appendChild(pre);
      card.appendChild(body);
    }

    slot.appendChild(card);
    hour.appendChild(timeEl);
    hour.appendChild(slot);
    root.appendChild(hour);

    root.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.entry.lineFrom } });
      view.focus();
    });

    return root;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildEntriesFromVisibleRanges(view: EditorView): TimelineEntry[] {
  const doc = view.state.doc;
  const entries: TimelineEntry[] = [];
  const seenLineFrom = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (seenLineFrom.has(line.from)) {
        pos = line.to + 1;
        continue;
      }
      seenLineFrom.add(line.from);

      const m = line.text.match(TIME_LINE_RE);
      if (!m) {
        pos = line.to + 1;
        continue;
      }

      const time = `${m[1]}:${m[2]}`;
      const head = (m[3] ?? "").trim();
      const bodyLines: string[] = [];
      let endLineNo = line.number;

      for (let ln = line.number + 1; ln <= doc.lines; ln++) {
        const next = doc.line(ln);
        const text = next.text;
        if (IS_TIME_LINE(text)) break;
        if (/^##/.test(text)) break;
        if (text.trim() === "") {
          bodyLines.push("");
          endLineNo = ln;
          continue;
        }
        if (!/^\s+/.test(text)) break;
        bodyLines.push(text.replace(/^\s+/, ""));
        endLineNo = ln;
      }

      const endLine = doc.line(endLineNo);
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
        from: line.from,
        to: endLine.to,
        lineFrom: line.from,
        time,
        title,
        locationText,
        participants,
        bodyLines,
        raw: [line.text, ...bodyLines].join("\n"),
      });

      pos = endLine.to + 1;
    }
  }
  return entries;
}

function buildDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  // Wrap EVERYTHING in try-catch as final safety
  try {
    // Guard: view must be ready with visible ranges
    if (!view.state || !view.visibleRanges?.length) {
      return Decoration.none;
    }

    // Guard: document must have content
    if (view.state.doc.length === 0) {
      return Decoration.none;
    }

    // Live Preview detection - check DOM first (safer)
    let isLive = false;
    try {
      isLive = !!view.dom?.closest(".markdown-source-view.is-live-preview");
      if (!isLive) {
        isLive = view.state.field(editorLivePreviewField, false) ?? false;
      }
    } catch {
      return Decoration.none;
    }

    if (!isLive) return Decoration.none;

    // Check file path
    let filePath: string | null = null;
    try {
      const editorInfo = view.state.field(editorInfoField, false);
      filePath = editorInfo?.file?.path ?? null;
    } catch {
      return Decoration.none;
    }

    if (!filePath) return Decoration.none;

    const folderPrefix = normalizePath(settings.dailyNotesFolder + "/");
    if (!normalizePath(filePath).startsWith(folderPrefix)) {
      return Decoration.none;
    }

    const entries = buildEntriesFromVisibleRanges(view);
    if (entries.length === 0) return Decoration.none;

    entries.sort((a, b) => a.from - b.from);

    const builder = new RangeSetBuilder<Decoration>();
    for (const entry of entries) {
      builder.add(
        entry.from,
        entry.to,
        Decoration.replace({ widget: new TimelineCardWidget(entry), block: true })
      );
    }

    return builder.finish();
  } catch (e) {
    console.warn("[TD] buildDecorations error:", e);
    return Decoration.none;
  }
}

function createTimelineLivePreview(settings: TemporalDriftSettings): Extension {
  return ViewPlugin.fromClass(
    class TimelineLivePreviewPlugin {
      decorations: DecorationSet = Decoration.none;

      constructor(_view: EditorView) {
        // CRITICAL: Do NOT call buildDecorations here!
        // editorInfoField is not ready during file open.
        // Decorations will be built on first update.
      }

      update(update: ViewUpdate): void {
        // Skip if view isn't ready (no document content)
        if (!update.view.state?.doc?.length) {
          return;
        }
        
        // Skip if no visible ranges (view not rendered)
        if (!update.view.visibleRanges?.length) {
          return;
        }
        
        // Only rebuild on actual content or viewport changes
        if (!update.docChanged && !update.viewportChanged) {
          return;
        }
        
        try {
          this.decorations = buildDecorations(update.view, settings);
        } catch (e) {
          console.warn("[TD] live preview update error:", e);
          this.decorations = Decoration.none;
        }
      }
    },
    {
      decorations: (v) => v.decorations ?? Decoration.none,
    }
  );
}

export class TimelineLivePreviewExtension {
  private extension: Extension[] = [];
  private settings: TemporalDriftSettings;

  constructor(settings: TemporalDriftSettings) {
    this.settings = settings;
    this.rebuild();
  }

  getExtension(): Extension[] {
    return this.extension;
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.rebuild();
  }

  private rebuild(): void {
    this.extension.length = 0;
    this.extension.push(createTimelineLivePreview(this.settings));
  }
}
