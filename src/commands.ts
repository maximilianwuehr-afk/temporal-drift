// ============================================================================
// Temporal Drift Commands
// ============================================================================

import { Editor, MarkdownView, MarkdownFileInfo } from "obsidian";
import type TemporalDriftPlugin from "./main";
import { formatTime, formatDate } from "./utils/time";

export function registerCommands(plugin: TemporalDriftPlugin): void {
  // Add inline note with timestamp
  plugin.addCommand({
    id: "add-inline-note",
    name: "Add inline note",
    editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
      const time = formatTime(new Date());
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);

      // If on an empty line, just insert time
      if (line.trim() === "") {
        editor.replaceRange(`${time} `, { line: cursor.line, ch: 0 });
        editor.setCursor({ line: cursor.line, ch: time.length + 1 });
      } else {
        // Insert on new line
        const endOfLine = { line: cursor.line, ch: line.length };
        editor.replaceRange(`\n\n${time} `, endOfLine);
        editor.setCursor({ line: cursor.line + 2, ch: time.length + 1 });
      }
    },
  });

  // Quick capture to today's note
  plugin.addCommand({
    id: "quick-capture",
    name: "Quick capture",
    callback: async () => {
      const today = formatDate(new Date());
      const path = `${plugin.settings.dailyNotesFolder}/${today}.md`;

      // Check if file exists
      let file = plugin.app.vault.getAbstractFileByPath(path);
      
      if (!file) {
        // Create the note
        const time = formatTime(new Date());
        const template = `# ${today}

## Thankful for


## Focus


${time} `;
        file = await plugin.app.vault.create(path, template);
      }

      // Open the note
      const leaf = plugin.app.workspace.getLeaf(false);
      await leaf.openFile(file as any);

      // Position cursor at end
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (view) {
        const editor = view.editor;
        const lastLine = editor.lastLine();
        const lastLineContent = editor.getLine(lastLine);
        editor.setCursor({ line: lastLine, ch: lastLineContent.length });
        editor.focus();
      }
    },
  });
}
