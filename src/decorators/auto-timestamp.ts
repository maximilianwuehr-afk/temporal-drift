// ============================================================================
// Auto-Timestamp Editor Extension
// ============================================================================

import { Extension } from "@codemirror/state";
import { keymap, EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { TemporalDriftSettings } from "../types";
import { formatTime } from "../utils/time";

/**
 * Creates a CodeMirror extension that auto-inserts timestamps on Enter
 * when editing daily notes.
 */
export function createAutoTimestampExtension(settings: TemporalDriftSettings): Extension {
  return keymap.of([
    {
      key: "Enter",
      run: (view: EditorView): boolean => {
        // Get the current file from editor info
        const editorInfo = view.state.field(editorInfoField, false);
        const file = editorInfo?.file;

        // Only apply in daily notes folder
        if (!file?.path.startsWith(settings.dailyNotesFolder)) {
          return false; // Let default handler run
        }

        const cursor = view.state.selection.main.head;
        const line = view.state.doc.lineAt(cursor);
        const lineText = line.text;

        // Check if current line starts with a time pattern (HH:mm)
        // No regex lookbehind for iOS compatibility
        const timeMatch = lineText.match(/^(\d{2}):(\d{2})/);

        if (timeMatch) {
          // User is on a time-stamped line, insert new timestamp
          const time = formatTime(new Date());
          const insert = `\n\n${time} `;

          view.dispatch({
            changes: { from: line.to, insert },
            selection: { anchor: line.to + insert.length },
          });

          return true; // We handled the key
        }

        return false; // Let default handler run
      },
    },
  ]);
}

/**
 * Creates an array-based extension that can be dynamically updated
 */
export class AutoTimestampExtension {
  private extension: Extension[] = [];
  private settings: TemporalDriftSettings;

  constructor(settings: TemporalDriftSettings) {
    this.settings = settings;
    this.rebuild();
  }

  /**
   * Get the extension array (for registerEditorExtension)
   */
  getExtension(): Extension[] {
    return this.extension;
  }

  /**
   * Update settings and rebuild extension
   */
  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.rebuild();
  }

  /**
   * Rebuild the extension with current settings
   */
  private rebuild(): void {
    this.extension.length = 0;
    this.extension.push(createAutoTimestampExtension(this.settings));
  }
}
