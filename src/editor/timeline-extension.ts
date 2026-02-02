// ============================================================================
// Timeline Editor Extension (CodeMirror)
//
// MVP: decorate HH:MM timestamps in daily notes so the editor becomes
// markdown-first while still visually scannable.
// ============================================================================

import { Extension, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { TemporalDriftSettings } from "../types";

const TIME_MARK = Decoration.mark({ class: "td-time", attributes: { "data-type": "time" } });

function buildTimeDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  const editorInfo = view.state.field(editorInfoField, false);
  const file = editorInfo?.file;

  // Only apply in the daily notes folder
  if (!file?.path.startsWith(settings.dailyNotesFolder)) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();

  // Only scan what is visible for performance
  for (const { from, to } of view.visibleRanges) {
    let pos = from;

    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.from > to) break;

      // Start-of-line HH:MM (keep regex iOS-safe, no lookbehind)
      const match = line.text.match(/^(\d{2}):(\d{2})/);
      if (match) {
        builder.add(line.from, line.from + 5, TIME_MARK);
      }

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

export function createTimelineDecorationExtension(settings: TemporalDriftSettings): Extension {
  const plugin = ViewPlugin.fromClass(
    class TimestampDecorations {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        this.decorations = buildTimeDecorations(view, settings);
      }

      update(update: ViewUpdate): void {
        // NOTE: keep this cheap; we only rebuild for doc edits or viewport shifts.
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildTimeDecorations(update.view, settings);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );

  return plugin;
}

/**
 * Array-based wrapper so we can rebuild on settings changes
 * (pattern matches AutoTimestampExtension).
 */
export class TimelineDecorationExtension {
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
    this.extension.push(createTimelineDecorationExtension(this.settings));
  }
}
