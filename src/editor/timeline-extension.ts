// ============================================================================
// Timeline Editor Extension (CodeMirror)
// TEST: Adding back editorInfoField access
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

const TIMESTAMP_REGEX = /^(\d{2}):(\d{2})\b/;

const timestampMark = Decoration.mark({
  class: "td-timestamp",
});

function buildDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  // Guard: view must be ready
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
  if (!filePath || !filePath.startsWith(settings.dailyNotesFolder)) {
    return Decoration.none;
  }

  // Build simple timestamp decorations
  const builder = new RangeSetBuilder<Decoration>();

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.from > to) break;

      const match = line.text.match(TIMESTAMP_REGEX);
      if (match) {
        builder.add(line.from, line.from + 5, timestampMark);
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

      constructor(_view: EditorView) {
        // Don't build in constructor
      }

      update(update: ViewUpdate): void {
        try {
          if (update.docChanged || update.viewportChanged || this.decorations === Decoration.none) {
            this.decorations = buildDecorations(update.view, settings);
          }
        } catch (e) {
          console.warn("[TD] timeline update error:", e);
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
