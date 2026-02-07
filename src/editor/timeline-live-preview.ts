// ============================================================================
// Timeline Live Preview (CodeMirror 6)
//
// In Obsidian Live Preview (editor), replace timestamp blocks with rich cards.
// Markdown-first: underlying text remains valid markdown.
// Performance: only scan visibleRanges.
// ============================================================================

import { Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
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
import {
  extractParticipants,
  extractPrimaryLink,
  isTimelineLine,
  parseTimelineLine,
  stripEventIdSuffix,
  stripWikilinks,
} from "../parsing/timeline";
import { formatTime } from "../utils/time";

const MAX_LOOKBACK_LINES = 50;
const MAX_BODY_LINES = 8;

type Participant = { target: string; display: string };

type TimelineEntry = {
  from: number; // doc offset start of block
  to: number; // doc offset end of block
  lineFrom: number; // doc offset start of the timestamp line
  editPos: number; // doc offset for editing (head start)
  time: string; // HH:mm or HH:mm–HH:mm
  title: string;
  locationText: string;
  participants: Participant[];
  bodyLines: string[];
  raw: string;
};

function getInitials(name: string): string {
  const cleaned = name.replace(/\[\[|\]\]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function focusAdjacentCard(current: HTMLElement, direction: 1 | -1): void {
  const scope = current.closest(".cm-content") ?? current.ownerDocument;
  const cards = Array.from(scope.querySelectorAll(".td-live-preview .event")) as HTMLElement[];
  const idx = cards.indexOf(current);
  if (idx < 0) return;

  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= cards.length) return;

  const next = cards[nextIdx];
  next.focus();
  next.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

class EmptyDailyStateWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "td-live-preview td-empty-state";

    const card = document.createElement("div");
    card.className = "td-empty-card";

    const title = document.createElement("div");
    title.className = "td-empty-title";
    title.textContent = "Start your timeline";

    const subtitle = document.createElement("div");
    subtitle.className = "td-empty-subtitle";
    subtitle.textContent = "Add your first timestamp entry to begin.";

    const btn = document.createElement("button");
    btn.className = "td-empty-action";
    btn.type = "button";
    btn.setAttribute("aria-label", "Insert first timestamp");
    btn.textContent = `${formatTime(new Date())} — `;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insert = `${formatTime(new Date())} — `;
      const at = view.state.doc.length;
      view.dispatch({
        changes: { from: at, to: at, insert },
        selection: { anchor: at + insert.length },
      });
      view.focus();
    });

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(btn);
    root.appendChild(card);

    return root;
  }
}

class TimelineCardWidget extends WidgetType {
  constructor(private entry: TimelineEntry) {
    super();
  }

  eq(other: TimelineCardWidget): boolean {
    return this.entry.raw === other.entry.raw;
  }

  private enterEdit(view: EditorView): void {
    view.dispatch({ selection: { anchor: this.entry.editPos } });
    view.focus();
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
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Timeline entry ${this.entry.time}`);

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

    const editBtn = document.createElement("button");
    editBtn.className = "event-edit-btn";
    editBtn.setAttribute("type", "button");
    editBtn.setAttribute("aria-label", "Edit entry");
    editBtn.setAttribute("title", "Edit");
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enterEdit(view);
    });
    right.appendChild(editBtn);

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
        a.setAttribute("role", "button");
        a.setAttribute("aria-label", `Jump to ${p.display}`);

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
      const nonEmptyBody = this.entry.bodyLines.filter((l) => l.trim().length > 0).map(stripWikilinks);
      const overflow = nonEmptyBody.length - MAX_BODY_LINES;
      const visible = nonEmptyBody.slice(0, MAX_BODY_LINES);
      if (overflow > 0) {
        visible.push(`… +${overflow} more`);
      }
      pre.textContent = visible.join("\n");

      body.appendChild(pre);
      card.appendChild(body);
    }

    card.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.focus();
    });

    card.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enterEdit(view);
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusAdjacentCard(card, 1);
        return;
      }

      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusAdjacentCard(card, -1);
        return;
      }

      if (e.key === "Enter" || e.key === "e") {
        e.preventDefault();
        this.enterEdit(view);
      }
    });

    slot.appendChild(card);
    hour.appendChild(timeEl);
    hour.appendChild(slot);
    root.appendChild(hour);

    return root;
  }
}

function findNearestTimeLineAbove(doc: EditorView["state"]["doc"], lineNo: number): number | null {
  for (let offset = 0; offset <= MAX_LOOKBACK_LINES && lineNo - offset >= 1; offset++) {
    const ln = lineNo - offset;
    const text = doc.line(ln).text;

    if (isTimelineLine(text)) return ln;
    if (/^##/.test(text)) break;

    // Stop if this is a non-indented, non-empty line (not part of a block)
    if (text.trim() !== "" && !/^\s+/.test(text)) break;
  }

  return null;
}

function buildEntries(view: EditorView): TimelineEntry[] {
  const doc = view.state.doc;
  const entries: TimelineEntry[] = [];
  const seenLineFrom = new Set<number>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;

    while (pos <= to) {
      let line = doc.lineAt(pos);
      if (line.from > to) break;

      // If we're starting inside a block body, jump to nearest timestamp line above.
      if (!isTimelineLine(line.text)) {
        const maybeStart = findNearestTimeLineAbove(doc, line.number);
        if (maybeStart) {
          line = doc.line(maybeStart);
          pos = line.from;
        }
      }

      if (seenLineFrom.has(line.from)) {
        pos = line.to + 1;
        continue;
      }
      seenLineFrom.add(line.from);

      const parsed = parseTimelineLine(line.text);
      if (!parsed) {
        pos = line.to + 1;
        continue;
      }

      const time = parsed.timeText;
      const head = parsed.head;
      const editPos = head.length > 0 ? line.from + parsed.headStart : line.to;

      const bodyLines: string[] = [];
      const rawLines: string[] = [line.text];
      let endLineNo = line.number;

      for (let ln = line.number + 1; ln <= doc.lines; ln++) {
        const next = doc.line(ln);
        const text = next.text;

        if (isTimelineLine(text)) break;
        if (/^##/.test(text)) break;

        if (text.trim() === "") {
          bodyLines.push("");
          rawLines.push(text);
          endLineNo = ln;
          continue;
        }

        if (!/^\s+/.test(text)) break;

        bodyLines.push(text.replace(/^\s+/, ""));
        rawLines.push(text);
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
        if (!primary) return "";
        let t = head;
        t = t.replace(/^\s*\[\[[^\]]+\]\]\s*/, "");
        const withIdx = t.indexOf(" with ");
        if (withIdx >= 0) t = t.slice(0, withIdx);
        return stripWikilinks(t).trim();
      })();

      const raw = rawLines.join("\n");

      entries.push({
        from: line.from,
        to: endLine.to,
        lineFrom: line.from,
        editPos,
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

function selectionOverlaps(selection: EditorView["state"]["selection"], from: number, to: number): boolean {
  for (const range of selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

function buildDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  const isLiveField = view.state.field(editorLivePreviewField, false);
  const isLiveDom = !!view.dom.closest(".markdown-source-view.is-live-preview");
  const isLive = isLiveField || isLiveDom;

  if (!isLive) return Decoration.none;

  const editorInfo = view.state.field(editorInfoField, false);
  const file = editorInfo?.file;
  const folderPrefix = normalizePath(settings.dailyNotesFolder + "/");
  const filePath = file?.path ? normalizePath(file.path) : "";

  if (!filePath || !filePath.startsWith(folderPrefix)) return Decoration.none;

  const entries = buildEntries(view);

  if (entries.length === 0) {
    const isEmptyDoc = view.state.doc.toString().trim().length === 0;
    if (!isEmptyDoc) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    builder.add(0, 0, Decoration.widget({ widget: new EmptyDailyStateWidget(), block: true, side: 1 }));
    return builder.finish();
  }

  entries.sort((a, b) => a.from - b.from);

  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection;

  for (const entry of entries) {
    // If selection is inside entry, keep raw markdown visible for editing.
    if (selectionOverlaps(selection, entry.from, entry.to)) continue;

    builder.add(entry.from, entry.to, Decoration.replace({ widget: new TimelineCardWidget(entry), block: true }));
  }

  return builder.finish();
}

function createTimelineLivePreview(settings: TemporalDriftSettings): Extension {
  const setTimelineDecorations = StateEffect.define<DecorationSet>();

  const timelineDecorationsField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(value, tr) {
      for (const effect of tr.effects) {
        if (effect.is(setTimelineDecorations)) return effect.value;
      }
      return value;
    },
  });

  const syncPlugin = ViewPlugin.fromClass(
    class TimelineLivePreviewSyncPlugin {
      private scheduled = false;
      private nextDecorations: DecorationSet | null = null;

      constructor(private view: EditorView) {
        this.scheduleSync();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.selectionSet) {
          this.scheduleSync();
        }
      }

      private scheduleSync(): void {
        this.nextDecorations = buildDecorations(this.view, settings);
        if (this.scheduled) return;

        this.scheduled = true;
        queueMicrotask(() => {
          this.scheduled = false;
          if (!this.nextDecorations) return;

          const next = this.nextDecorations;
          this.nextDecorations = null;

          try {
            this.view.dispatch({ effects: setTimelineDecorations.of(next) });
          } catch {
            // View might be gone during shutdown/reconfiguration.
          }
        });
      }
    }
  );

  return [timelineDecorationsField, EditorView.decorations.from(timelineDecorationsField), syncPlugin];
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
