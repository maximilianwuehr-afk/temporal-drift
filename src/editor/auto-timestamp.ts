// ============================================================================
// Auto-Timestamp Editor Extension (CodeMirror)
//
// Phase 1: When pressing Enter at the end of a time-stamped line (HH:mm ...),
// insert a new blank line + the current time.
//
// Markdown remains source of truth; this only inserts valid markdown text.
// ============================================================================

import { Extension } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { TemporalDriftSettings } from "../types";
import { formatTime } from "../utils/time";
import { pathInFolder } from "../utils/folder-match";
import { parseTimelineLine } from "../parsing/timeline";

export function createAutoTimestampExtension(settings: TemporalDriftSettings): Extension {
  const inDailyNote = (view: EditorView): boolean => {
    // Safely access file — may not exist on "New tab" screen
    let file: { path: string } | null | undefined;
    try {
      const editorInfo = view.state.field(editorInfoField, false);
      file = editorInfo?.file;
    } catch {
      return false;
    }

    return !!file?.path && pathInFolder(file.path, settings.dailyNotesFolder, ["Daily notes"]);
  };

  return keymap.of([
    {
      key: "Shift-Enter",
      run: (view: EditorView): boolean => {
        if (!inDailyNote(view)) return false;

        const cursor = view.state.selection.main.head;
        const line = view.state.doc.lineAt(cursor);

        if (cursor !== line.to) return false;
        if (!parseTimelineLine(line.text)) return false;

        const insert = "\n      ";
        view.dispatch({
          changes: { from: line.to, insert },
          selection: { anchor: line.to + insert.length },
        });

        return true;
      },
    },
    {
      key: "Enter",
      run: (view: EditorView): boolean => {
        if (!inDailyNote(view)) return false;

        const cursor = view.state.selection.main.head;
        const line = view.state.doc.lineAt(cursor);

        // Only trigger when the cursor is at the END of the line
        // (avoid messing with normal newline behavior mid-line)
        if (cursor !== line.to) {
          return false;
        }

        // Must be a top-level timeline line.
        if (!parseTimelineLine(line.text)) {
          return false;
        }

        const time = formatTime(new Date());
        const insert = `\n\n${time} `;

        view.dispatch({
          changes: { from: line.to, insert },
          selection: { anchor: line.to + insert.length },
        });

        return true;
      },
    },
  ]);
}

/**
 * Array wrapper so settings updates rebuild the extension.
 * (Obsidian needs an Extension[] for registerEditorExtension.)
 */
export class AutoTimestampExtension {
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
    this.extension.push(createAutoTimestampExtension(this.settings));
  }
}
