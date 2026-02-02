// ============================================================================
// Timeline Decorations - CodeMirror EditorExtension
// ============================================================================
//
// This replaces the separate ItemView with inline decorations.
// Markdown remains source of truth, we just render it beautifully.
//

import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { RangeSetBuilder, Extension } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { editorInfoField } from "obsidian";
import { TemporalDriftSettings } from "../types";

// ============================================================================
// Decoration Styles
// ============================================================================

const timeDecoration = Decoration.mark({
  class: "td-time",
  attributes: { "data-type": "time" },
});

const taskOpenDecoration = Decoration.mark({
  class: "td-task td-task-open",
});

const taskDoneDecoration = Decoration.mark({
  class: "td-task td-task-done",
});

const eventDecoration = Decoration.mark({
  class: "td-event",
});

const noteDecoration = Decoration.mark({
  class: "td-note",
});

// ============================================================================
// Timeline ViewPlugin
// ============================================================================

function buildDecorations(view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  
  // Check if we're in a daily note
  const editorInfo = view.state.field(editorInfoField, false);
  const file = editorInfo?.file;
  
  if (!file?.path.startsWith(settings.dailyNotesFolder)) {
    return builder.finish();
  }

  const doc = view.state.doc;
  
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i);
    const text = line.text;
    
    // Match time entries: HH:MM at start of line
    const timeMatch = text.match(/^(\d{2}:\d{2})\s+(.*)$/);
    
    if (timeMatch) {
      const timeStart = line.from;
      const timeEnd = line.from + timeMatch[1].length;
      const contentStart = timeEnd + 1; // after space
      const contentEnd = line.to;
      
      // Decorate the time
      builder.add(timeStart, timeEnd, timeDecoration);
      
      // Parse and decorate the content
      const content = timeMatch[2];
      
      // Task: - [ ] or - [x]
      const taskMatch = content.match(/^-\s*\[\s*([xX ]?)\s*\]\s*(.*)$/);
      if (taskMatch) {
        const isDone = taskMatch[1].toLowerCase() === "x";
        builder.add(contentStart, contentEnd, isDone ? taskDoneDecoration : taskOpenDecoration);
        continue;
      }
      
      // Event: [[Title ~eventId]]
      const eventMatch = content.match(/^\[\[([^~\]]+)\s*~([^\]]+)\]\]/);
      if (eventMatch) {
        builder.add(contentStart, contentEnd, eventDecoration);
        continue;
      }
      
      // Regular note
      builder.add(contentStart, contentEnd, noteDecoration);
    }
  }
  
  return builder.finish();
}

/**
 * Creates the timeline decoration ViewPlugin
 */
export function createTimelineDecorations(settings: TemporalDriftSettings): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      settings: TemporalDriftSettings;

      constructor(view: EditorView) {
        this.settings = settings;
        this.decorations = buildDecorations(view, this.settings);
      }

      update(update: ViewUpdate) {
        // Rebuild decorations if document changed or viewport changed significantly
        if (update.docChanged || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, this.settings);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
    }
  );
}

// ============================================================================
// Wrapper class for settings updates
// ============================================================================

export class TimelineDecorationsExtension {
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
    this.extension.push(createTimelineDecorations(this.settings));
  }
}
