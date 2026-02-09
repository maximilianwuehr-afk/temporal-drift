// ============================================================================
// Temporal Drift Commands
// ============================================================================

import { Editor, MarkdownView, MarkdownFileInfo, Notice, TFile, normalizePath } from "obsidian";
import type TemporalDriftPlugin from "./main";
import { formatTime, formatDate } from "./utils/time";
import { pathInFolder } from "./utils/folder-match";
import { parseTaskSnapshotFromContent, taskLinkMatches, TaskSnapshot } from "./services/task-allocation-utils";
import { parseTimelineLine, parseTaskHead } from "./parsing/timeline";

type TaskAllocation = { dayPath: string; day: string; time: string };

type BacklinksForFile = { data?: Record<string, unknown> };

function getBacklinkSourcePaths(plugin: TemporalDriftPlugin, file: TFile): string[] {
  const getBacklinksForFile = (plugin.app.metadataCache as any).getBacklinksForFile as
    | ((file: TFile) => BacklinksForFile)
    | undefined;

  const backlinks = getBacklinksForFile?.(file);
  return backlinks?.data ? Object.keys(backlinks.data) : [];
}

function getAllocationCandidates(plugin: TemporalDriftPlugin, taskFile: TFile): TFile[] {
  const sources = getBacklinkSourcePaths(plugin, taskFile);

  const candidates: TFile[] = [];
  for (const p of sources) {
    const f = plugin.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile && f.extension === "md") {
      if (pathInFolder(f.path, plugin.settings.dailyNotesFolder, ["Daily notes"])) {
        candidates.push(f);
      }
    }
  }

  if (candidates.length > 0) return candidates;

  // Fallback: scan daily notes folder.
  const prefix = normalizePath(plugin.settings.dailyNotesFolder + "/");
  return plugin.app.vault
    .getMarkdownFiles()
    .filter((f) => normalizePath(f.path).startsWith(prefix));
}

function parseAllocationsFromDailyNote(content: string, dayPath: string, taskPath: string): TaskAllocation[] {
  const day = dayPath.split("/").pop()?.replace(/\.md$/i, "") ?? dayPath;
  const out: TaskAllocation[] = [];

  for (const line of content.split("\n")) {
    const parsed = parseTimelineLine(line);
    if (!parsed) continue;

    if (!parseTaskHead(parsed.headRaw).isTask) continue;

    const link = parsed.headRaw.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    if (!link?.[1]) continue;

    if (!taskLinkMatches(link[1].trim(), taskPath)) continue;

    const time = parsed.timeText.split("–")[0]?.trim() || parsed.timeText;
    out.push({ dayPath, day, time });
  }

  return out;
}

async function computeAllocations(plugin: TemporalDriftPlugin, taskFile: TFile): Promise<TaskAllocation[]> {
  const files = getAllocationCandidates(plugin, taskFile);
  const all: TaskAllocation[] = [];

  for (const f of files) {
    try {
      const content = await plugin.app.vault.read(f);
      all.push(...parseAllocationsFromDailyNote(content, f.path, taskFile.path));
    } catch {
      // ignore
    }
  }

  // De-dupe
  const seen = new Set<string>();
  return all.filter((a) => {
    const key = `${a.dayPath}#${a.time}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function canonicalStatus(snapshot: TaskSnapshot): "open" | "done" {
  return snapshot.done ? "done" : "open";
}

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

  // Add inline task with timestamp
  plugin.addCommand({
    id: "add-inline-task",
    name: "Add inline task",
    editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
      const time = formatTime(new Date());
      const cursor = editor.getCursor();
      const line = editor.getLine(cursor.line);

      const insertion = `${time} — [ ] `;

      if (line.trim() === "") {
        editor.replaceRange(insertion, { line: cursor.line, ch: 0 });
        editor.setCursor({ line: cursor.line, ch: insertion.length });
      } else {
        const endOfLine = { line: cursor.line, ch: line.length };
        editor.replaceRange(`\n\n${insertion}`, endOfLine);
        editor.setCursor({ line: cursor.line + 2, ch: insertion.length });
      }
    },
  });

  // Migrate Tasks/ notes to canonical frontmatter schema
  plugin.addCommand({
    id: "migrate-task-schema",
    name: "Migrate task schema (frontmatter)",
    callback: async () => {
      const tasksPrefix = normalizePath(plugin.settings.tasksFolder + "/");
      const taskFiles = plugin.app.vault
        .getMarkdownFiles()
        .filter((f) => normalizePath(f.path).startsWith(tasksPrefix))
        .sort((a, b) => a.path.localeCompare(b.path));

      let updated = 0;
      let failed = 0;

      new Notice(`[Temporal Drift] Migrating ${taskFiles.length} task notes…`, 2500);

      for (const file of taskFiles) {
        try {
          const content = await plugin.app.vault.read(file);
          const cache = plugin.app.metadataCache.getFileCache(file);
          const fm = cache?.frontmatter as Record<string, unknown> | undefined;
          const snapshot = parseTaskSnapshotFromContent(content, fm);

          const priority = snapshot.priority ?? plugin.settings.defaultPriority;
          const allocations = await computeAllocations(plugin, file);

          await plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
            frontmatter.status = canonicalStatus({ ...snapshot, priority });
            frontmatter.done = snapshot.done;
            frontmatter.priority = priority;

            const existing = (frontmatter as any).allocations;
            if (Array.isArray(existing)) {
              const merged = [...existing, ...allocations];
              const seen = new Set<string>();
              (frontmatter as any).allocations = merged.filter((a: any) => {
                const dayPath = String(a?.dayPath ?? a?.path ?? "");
                const time = String(a?.time ?? "");
                const key = `${dayPath}#${time}`;
                if (!dayPath || !time) return false;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
              });
            } else {
              (frontmatter as any).allocations = allocations;
            }
          });

          updated++;
        } catch (err) {
          failed++;
          console.error("[Temporal Drift] migrate-task-schema failed", file.path, err);
        }
      }

      new Notice(`[Temporal Drift] Task migration complete: ${updated} updated, ${failed} failed.`, 6000);
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
