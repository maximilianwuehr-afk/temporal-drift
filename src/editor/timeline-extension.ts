// ============================================================================
// Timeline Editor Extension (CodeMirror)
//
// Phase 1:
// - Detect HH:mm at start of line
// - Decorate timestamps (monospace semi-bold amber)
// - Highlight the current time block (subtle left border accent)
//
// Markdown-first: decorations only; underlying text stays valid markdown.
// Performance: only scan visibleRanges.
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

// Regex to match timestamps at the start of lines: HH:mm
const TIMESTAMP_REGEX = /^(\d{2}):(\d{2})\b/;

const timestampMark = Decoration.mark({
  class: "td-timestamp",
});

const currentBlockMark = Decoration.mark({
  class: "td-current-block",
});

function minutesSinceMidnight(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function parseTimeToMinutes(hh: string, mm: string): number {
  const h = Number(hh);
  const m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

type DecoSpec = { from: number; to: number; deco: Decoration };

function buildDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  // Safely access file — may not exist on "New tab" screen
  let file: { path: string } | null | undefined;
  try {
    const editorInfo = view.state.field(editorInfoField, false);
    file = editorInfo?.file;
  } catch {
    return Decoration.none;
  }

  // Only apply to daily notes
  if (!file?.path || !file.path.startsWith(settings.dailyNotesFolder)) {
    return Decoration.none;
  }

  const nowMins = minutesSinceMidnight(new Date());

  const decos: DecoSpec[] = [];

  // Track the best visible candidate block.
  // Prefer the closest time <= now; if none, use the closest time > now.
  let bestPast: { diff: number; from: number; to: number } | null = null;
  let bestFuture: { diff: number; from: number; to: number } | null = null;

  for (const { from, to } of view.visibleRanges) {
    let pos = from;

    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.from > to) break;

      const match = line.text.match(TIMESTAMP_REGEX);
      if (match) {
        const timeMins = parseTimeToMinutes(match[1], match[2]);
        if (Number.isFinite(timeMins)) {
          // Timestamp decoration (just the HH:mm part)
          decos.push({ from: line.from, to: line.from + 5, deco: timestampMark });

          const diff = timeMins - nowMins;
          if (diff <= 0) {
            const abs = Math.abs(diff);
            if (!bestPast || abs < bestPast.diff) {
              bestPast = { diff: abs, from: line.from, to: line.to };
            }
          } else {
            if (!bestFuture || diff < bestFuture.diff) {
              bestFuture = { diff, from: line.from, to: line.to };
            }
          }
        }
      }

      pos = line.to + 1;
    }
  }

  const current = bestPast ?? bestFuture;
  if (current) {
    decos.push({ from: current.from, to: current.to, deco: currentBlockMark });
  }

  // RangeSetBuilder requires sorted ranges.
  decos.sort((a, b) => (a.from - b.from) || (a.to - b.to));

  const builder = new RangeSetBuilder<Decoration>();
  for (const d of decos) {
    builder.add(d.from, d.to, d.deco);
  }

  return builder.finish();
}

function createTimelineExtension(settings: TemporalDriftSettings): Extension {
  return ViewPlugin.fromClass(
    class TimelineDecorations {
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

/**
 * Array wrapper to allow settings updates.
 */
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
