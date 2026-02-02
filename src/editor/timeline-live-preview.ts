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
  from: number; // doc offset
  to: number; // doc offset (end of replaced block)
  lineFrom: number; // line start offset
  time: string; // HH:mm
  title: string;
  locationText: string;
  participants: Participant[];
  bodyLines: string[]; // stripped of leading indentation
  raw: string; // used for widget equality
};

const TIME_LINE_RE = /^(\d{2}):(\d{2})\s+(.*)$/;
const IS_TIME_LINE = (text: string) => /^\d{2}:\d{2}\s/.test(text);

function stripEventIdSuffix(title: string): string {
  return title.replace(/\s*~[a-zA-Z0-9]+$/, "").trim();
}

function parseWikilinkDisplay(raw: string): { target: string; display: string } {
  // raw: "path/to/File|Display" or "path/to/File".
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
    const duration = document.createElement("span");
    duration.className = "event-duration";
    duration.textContent = "";
    right.appendChild(duration);

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

        // Let Obsidian handle link open on click by placing cursor near link.
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

      // Render the body as a simple text block (preview only).
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

    // Click anywhere on the card => move cursor to the underlying markdown.
    root.addEventListener("click", (e) => {
      e.preventDefault();
      view.dispatch({ selection: { anchor: this.entry.lineFrom } });
      view.focus();
    });

    return root;
  }

  ignoreEvent(): boolean {
    // Allow the editor to handle selection/focus, but we also have click handlers.
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

      // Collect the body lines.
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

      // Derive title, participants, and a "location" line (prototype-like).
      const primary = extractPrimaryLink(head);
      const participants = extractParticipants(head);

      const title = (() => {
        if (primary) return stripEventIdSuffix(primary.display);
        const plain = head.split(" with ")[0];
        return stripEventIdSuffix(stripWikilinks(plain || "(empty)"));
      })();

      const locationText = (() => {
        // Remove the leading primary link and the participants list for the location line.
        let t = head;
        t = t.replace(/^\s*\[\[[^\]]+\]\]\s*/, "");
        const withIdx = t.indexOf(" with ");
        if (withIdx >= 0) t = t.slice(0, withIdx);
        return stripWikilinks(t).trim();
      })();

      const raw = [line.text, ...bodyLines].join("\n");

      entries.push({
        from: line.from,
        to: endLine.to,
        lineFrom: line.from,
        time,
        title,
        locationText,
        participants,
        bodyLines,
        raw,
      });

      pos = endLine.to + 1;
    }
  }

  return entries;
}

function buildDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  // DEBUG (temporary): prove whether this is being called at all.
  // eslint-disable-next-line no-console
  console.log("[TD] buildDecorations called");

  // Live Preview detection: field (preferred) + DOM fallback.
  const isLiveField = view.state.field(editorLivePreviewField, false);
  const isLiveDom = !!view.dom.closest(".markdown-source-view.is-live-preview");
  const isLive = isLiveField || isLiveDom;

  // Only in daily notes
  const editorInfo = view.state.field(editorInfoField, false);
  const file = editorInfo?.file;

  // eslint-disable-next-line no-console
  console.log("[TD] isLiveField=", isLiveField, "isLiveDom=", isLiveDom, "file=", file?.path, "folder=", settings.dailyNotesFolder);

  if (!isLive) return Decoration.none;

  const folderPrefix = normalizePath(settings.dailyNotesFolder + "/");
  const filePath = file?.path ? normalizePath(file.path) : "";

  if (!filePath.startsWith(folderPrefix)) {
    // eslint-disable-next-line no-console
    console.log("[TD] Skipping - not in daily notes folder", { filePath, folderPrefix });
    return Decoration.none;
  }

  const entries = buildEntriesFromVisibleRanges(view);
  // eslint-disable-next-line no-console
  console.log("[TD] entries=", entries.length);
  if (entries.length === 0) return Decoration.none;

  // Sort by from; CodeMirror requires ordered ranges.
  entries.sort((a, b) => a.from - b.from);

  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) {
    const widget = new TimelineCardWidget(entry);

    // Replace the entire block (timestamp line + indented children + blank separators).
    builder.add(
      entry.from,
      entry.to,
      Decoration.replace({ widget, block: true })
    );
  }

  return builder.finish();
}

function createTimelineLivePreview(settings: TemporalDriftSettings): Extension {
  return ViewPlugin.fromClass(
    class TimelineLivePreviewPlugin {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, settings);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, settings);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
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
