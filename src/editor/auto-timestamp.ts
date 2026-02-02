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

export function createAutoTimestampExtension(settings: TemporalDriftSettings): Extension {
  return keymap.of([
    {
      key: "Enter",
      run: (view: EditorView): boolean => {
        // Safely access file — may not exist on "New tab" screen
        let file: { path: string } | null | undefined;
        try {
          const editorInfo = view.state.field(editorInfoField, false);
          file = editorInfo?.file;
        } catch {
          return false;
        }

        // Only apply inside the daily notes folder
        if (!file?.path || !file.path.startsWith(settings.dailyNotesFolder)) {
          return false;
        }

        const cursor = view.state.selection.main.head;
        const line = view.state.doc.lineAt(cursor);

        // Only trigger when the cursor is at the END of the line
        // (avoid messing with normal newline behavior mid-line)
        if (cursor !== line.to) {
          return false;
        }

        // Must be a time-stamped line
        // No regex lookbehind for iOS compatibility
        const timeMatch = line.text.match(/^(\d{2}):(\d{2})\b/);
        if (!timeMatch) {
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
