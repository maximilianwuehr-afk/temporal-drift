// ============================================================================
// Timeline Editor Extension (CodeMirror)
//
// Lightweight timestamp tinting in raw editor lines.
// ============================================================================

import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { Extension, RangeSetBuilder } from "@codemirror/state";
import { editorInfoField } from "obsidian";
import { TemporalDriftSettings } from "../types";
import { extractPrimaryLink, parseTaskHead, parseTimelineLine } from "../parsing/timeline";
import { pathInFolder } from "../utils/folder-match";

const timestampMark = Decoration.mark({
  class: "td-timestamp",
});

function parseTimeWindow(timeText: string): { start: number; end: number | null } | null {
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

function isEntryNow(timeText: string, now = new Date()): boolean {
  const window = parseTimeWindow(timeText);
  if (!window) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (window.end !== null) {
    return currentMinutes >= window.start && currentMinutes <= window.end;
  }

  return currentMinutes >= window.start && currentMinutes < window.start + 60;
}

function findTimeRangeInLine(text: string): { start: number; end: number } | null {
  const m = text.match(/`?(\d{1,2}[:.]\d{2}(?:\s*[–-]\s*\d{1,2}[:.]\d{2})?)`?/);
  if (!m) return null;
  const token = m[1];
  const matchText = m[0];
  const from = (m.index ?? 0) + matchText.indexOf(token);
  return { start: from, end: from + token.length };
}

function buildLineClass(head: string, timeText: string): string {
  const task = parseTaskHead(head);
  const hasPrimary = !!extractPrimaryLink(head);
  const kind = task.isTask ? "td-line--task" : hasPrimary ? "td-line--event" : "td-line--note";
  const now = isEntryNow(timeText) ? " td-line--now" : "";
  return `td-line ${kind}${now}`;
}

function buildDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  if (!view.state || !view.visibleRanges || view.visibleRanges.length === 0) {
    return Decoration.none;
  }

  // Safely access file
  let filePath: string | null = null;
  try {
    const editorInfo = view.state.field(editorInfoField, false);
    filePath = editorInfo?.file?.path ?? null;
  } catch {
    return Decoration.none;
  }

  // Only apply to daily notes
  if (!filePath || !pathInFolder(filePath, settings.dailyNotesFolder, ["Daily notes"])) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.from > to) break;

      const parsed = parseTimelineLine(line.text);
      if (parsed) {
        const timeRange = findTimeRangeInLine(line.text);
        if (timeRange) {
          const start = line.from + timeRange.start;
          const end = line.from + timeRange.end;
          builder.add(start, end, timestampMark);
        }

        builder.add(
          line.from,
          line.from,
          Decoration.line({
            class: buildLineClass(parsed.head, parsed.timeText),
          })
        );
      }

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

function createTimelineExtension(settings: TemporalDriftSettings): Extension {
  return ViewPlugin.fromClass(
    class TimelineDecorations {
      decorations: DecorationSet = Decoration.none;

      update(update: ViewUpdate): void {
        try {
          if (update.docChanged || update.viewportChanged || this.decorations === Decoration.none) {
            this.decorations = buildDecorations(update.view, settings);
          }
        } catch {
          this.decorations = Decoration.none;
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

export class TimelineExtension {
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
    this.extension.push(createTimelineExtension(this.settings));
  }
}
