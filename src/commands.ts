// ============================================================================
// Temporal Drift Commands
// ============================================================================

import { Editor, MarkdownView } from "obsidian";
import type TemporalDriftPlugin from "./main";
import { formatTime, formatDate } from "./utils/time";

export function registerCommands(plugin: TemporalDriftPlugin): void {
  // Create daily note
  plugin.addCommand({
    id: "create-daily-note",
    name: "Create daily note",
    callback: async () => {
      await plugin.getDailyNoteService().openToday();
    },
  });

  // Open week view
  plugin.addCommand({
    id: "open-week-view",
    name: "Open week view",
    callback: async () => {
      await plugin.activateView();
    },
  });

  // Go to today in view
  plugin.addCommand({
    id: "go-to-today",
    name: "Go to today",
    callback: async () => {
      const view = plugin.getView();
      if (view) {
        await view.goToToday();
      } else {
        await plugin.activateView();
      }
    },
  });

  // Add inline note with timestamp
  plugin.addCommand({
    id: "add-inline-note",
    name: "Add inline note",
    editorCallback: (editor: Editor, view: MarkdownView) => {
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
      const time = formatTime(new Date());

      // Append timestamped entry to today's note
      await plugin.getDailyNoteService().appendEntry(today, time, "");

      // Open the note and position cursor
      await plugin.getDailyNoteService().openToday();

      // Use workspace event to insert cursor after file is ready
      const onActiveLeafChange = plugin.app.workspace.on("active-leaf-change", () => {
        const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          const editor = view.editor;
          const lastLine = editor.lastLine();
          const lastLineContent = editor.getLine(lastLine);

          // Position cursor at end of the timestamp line
          editor.setCursor({ line: lastLine, ch: lastLineContent.length });
          editor.focus();
        }
        // Unregister after first trigger
        plugin.app.workspace.offref(onActiveLeafChange);
      });
    },
  });

  // Open task sidebar
  plugin.addCommand({
    id: "open-task-sidebar",
    name: "Open task sidebar",
    callback: async () => {
      await plugin.activateTaskSidebar();
    },
  });

  // Create new task
  plugin.addCommand({
    id: "create-task",
    name: "Create task",
    callback: async () => {
      const title = prompt("Task name:");
      if (title) {
        const file = await plugin.getTaskIndexService().createTask(title);
        await plugin.app.workspace.getLeaf(false).openFile(file);
      }
    },
  });
}
