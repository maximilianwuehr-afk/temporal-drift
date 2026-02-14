// ============================================================================
// Temporal Drift Commands
// ============================================================================

import { Editor, MarkdownView, MarkdownFileInfo, Notice, TFile, normalizePath } from "obsidian";
import type TemporalDriftPlugin from "./main";
import { formatTime, formatDate } from "./utils/time";
import { pathInFolder } from "./utils/folder-match";
import { parseTaskSnapshotFromContent, taskLinkMatches, TaskSnapshot } from "./services/task-allocation-utils";
import {
  extractMeetingJoinUrl,
  extractPrimaryLink,
  minutesSinceMidnight,
  parseTimelineLine,
  parseTaskHead,
} from "./parsing/timeline";

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

type JoinMeetingCandidate = {
  time: string;
  minutes: number;
  title: string;
  joinUrl: string;
};

function openExternalUrl(plugin: TemporalDriftPlugin, url: string): void {
  const openWithDefaultApp = (plugin.app as any).openWithDefaultApp as ((targetUrl: string) => void) | undefined;
  if (openWithDefaultApp) {
    openWithDefaultApp(url);
    return;
  }

  window.open(url);
}

async function resolveJoinUrlForEntry(
  plugin: TemporalDriftPlugin,
  sourcePath: string,
  head: string,
  bodyLines: string[]
): Promise<string | null> {
  const inline = extractMeetingJoinUrl([head, ...bodyLines]);
  if (inline) return inline;

  const primary = extractPrimaryLink(head);
  if (!primary) return null;

  const linked = plugin.app.metadataCache.getFirstLinkpathDest(primary.target, sourcePath);
  if (!(linked instanceof TFile)) return null;

  try {
    const linkedContent = await plugin.app.vault.read(linked);
    return extractMeetingJoinUrl(linkedContent);
  } catch {
    return null;
  }
}

async function collectJoinCandidatesForDate(
  plugin: TemporalDriftPlugin,
  date: Date
): Promise<JoinMeetingCandidate[]> {
  const dateStr = formatDate(date);
  const dayPath = normalizePath(`${plugin.settings.dailyNotesFolder}/${dateStr}.md`);
  const dayFile = plugin.app.vault.getAbstractFileByPath(dayPath);
  if (!(dayFile instanceof TFile)) return [];

  let content: string;
  try {
    content = await plugin.app.vault.read(dayFile);
  } catch {
    return [];
  }

  const lines = content.split("\n");
  const candidates: JoinMeetingCandidate[] = [];

  for (let i = 0; i < lines.length; i++) {
    const parsed = parseTimelineLine(lines[i]);
    if (!parsed) continue;

    if (parseTaskHead(parsed.head).isTask) continue;

    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (parseTimelineLine(next)) break;
      if (next.match(/^##/)) break;

      if (next.trim() === "") {
        bodyLines.push("");
        j++;
        continue;
      }

      if (!/^\s+/.test(next)) break;

      bodyLines.push(next.replace(/^\s+/, ""));
      j++;
    }

    const joinUrl = await resolveJoinUrlForEntry(plugin, dayPath, parsed.head, bodyLines);
    if (!joinUrl) {
      i = j - 1;
      continue;
    }

    const minutes = minutesSinceMidnight(parsed.timeText);
    if (!Number.isFinite(minutes)) {
      i = j - 1;
      continue;
    }

    const title = (() => {
      const primary = extractPrimaryLink(parsed.head);
      if (primary) return primary.display.replace(/\s*~[^\s\]|]+$/, "").trim();
      return parsed.head.slice(0, 80).trim() || "Meeting";
    })();

    candidates.push({
      time: parsed.timeText,
      minutes,
      title,
      joinUrl,
    });

    i = j - 1;
  }

  return candidates.sort((a, b) => a.minutes - b.minutes);
}

async function findNextMeetingCandidate(plugin: TemporalDriftPlugin): Promise<JoinMeetingCandidate | null> {
  const now = new Date();
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  const todayCandidates = await collectJoinCandidatesForDate(plugin, now);
  const upcomingToday = todayCandidates.find((c) => c.minutes >= nowMinutes - 15);
  if (upcomingToday) return upcomingToday;

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowCandidates = await collectJoinCandidatesForDate(plugin, tomorrow);
  if (tomorrowCandidates.length > 0) return tomorrowCandidates[0];

  return null;
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

  // Google Tasks sync commands
  plugin.addCommand({
    id: "google-tasks-connect",
    name: "Google Tasks: Connect",
    callback: async () => {
      await (plugin as any).connectGoogleTasks?.();
    },
  });

  plugin.addCommand({
    id: "google-tasks-sync-now",
    name: "Google Tasks: Sync now",
    callback: async () => {
      await (plugin as any).syncGoogleTasksNow?.();
    },
  });

  plugin.addCommand({
    id: "google-tasks-disconnect",
    name: "Google Tasks: Disconnect",
    callback: async () => {
      await (plugin as any).disconnectGoogleTasks?.();
    },
  });

  plugin.addCommand({
    id: "google-tasks-show-sync-status",
    name: "Google Tasks: Show sync status",
    callback: async () => {
      const summary = (plugin as any).formatGoogleTasksSyncStatus?.() as string | undefined;
      new Notice(summary || "No Google Tasks sync status available yet.", 8000);
    },
  });

  plugin.addCommand({
    id: "google-tasks-preview-sync-changes",
    name: "Google Tasks: Preview sync changes",
    callback: async () => {
      try {
        const summary = (await (plugin as any).previewGoogleTasksSync?.()) as string | undefined;
        new Notice(summary || "No preview available.", 9000);
      } catch (error) {
        new Notice(`[Temporal Drift] Preview failed: ${String((error as any)?.message ?? error)}`, 5000);
      }
    },
  });

  plugin.addCommand({
    id: "calendar-sync-now",
    name: "Calendar: Sync active day now",
    callback: async () => {
      const active = plugin.app.workspace.getActiveFile();
      const date =
        active && pathInFolder(active.path, plugin.settings.dailyNotesFolder, ["Daily notes"])
          ? active.basename
          : formatDate(new Date());

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        new Notice("[Temporal Drift] Active file is not a daily note.", 4000);
        return;
      }

      await (plugin as any).syncCalendarDateNow?.(date);
      new Notice(`[Temporal Drift] Calendar sync finished for ${date}.`, 3000);
    },
  });

  plugin.addCommand({
    id: "google-calendar-connect",
    name: "Google Calendar: Connect",
    callback: async () => {
      await (plugin as any).connectGoogleCalendar?.();
    },
  });

  plugin.addCommand({
    id: "google-calendar-disconnect",
    name: "Google Calendar: Disconnect",
    callback: async () => {
      await (plugin as any).disconnectGoogleCalendar?.();
    },
  });

  plugin.addCommand({
    id: "google-calendar-show-status",
    name: "Google Calendar: Show status",
    callback: async () => {
      const summary = (plugin as any).formatGoogleCalendarStatus?.() as string | undefined;
      new Notice(summary || "No Google Calendar status available.", 8000);
    },
  });

  plugin.addCommand({
    id: "calendar-preview-sync",
    name: "Calendar: Preview active day sync",
    callback: async () => {
      const active = plugin.app.workspace.getActiveFile();
      const date =
        active && pathInFolder(active.path, plugin.settings.dailyNotesFolder, ["Daily notes"])
          ? active.basename
          : formatDate(new Date());

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        new Notice("[Temporal Drift] Active file is not a daily note.", 4000);
        return;
      }

      const summary = (await (plugin as any).previewCalendarDateSync?.(date)) as string | undefined;
      new Notice(summary || "No calendar preview available.", 9000);
    },
  });

  plugin.addCommand({
    id: "calendar-restore-suppressed",
    name: "Calendar: Restore suppressed events for active day",
    callback: async () => {
      const active = plugin.app.workspace.getActiveFile();
      const date =
        active && pathInFolder(active.path, plugin.settings.dailyNotesFolder, ["Daily notes"])
          ? active.basename
          : formatDate(new Date());

      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        new Notice("[Temporal Drift] Active file is not a daily note.", 4000);
        return;
      }

      const restored = (await (plugin as any).restoreCalendarSuppressedForDate?.(date)) as number | undefined;
      new Notice(`[Temporal Drift] Restored ${restored ?? 0} suppressed event(s) for ${date}.`, 5000);
    },
  });

  plugin.addCommand({
    id: "join-next-meeting",
    name: "Join next meeting",
    callback: async () => {
      try {
        const next = await findNextMeetingCandidate(plugin);
        if (!next) {
          new Notice("[Temporal Drift] No upcoming meeting with a join link found.", 4000);
          return;
        }

        openExternalUrl(plugin, next.joinUrl);
        new Notice(`[Temporal Drift] Joining ${next.title} (${next.time}).`, 3000);
      } catch (error) {
        new Notice(`[Temporal Drift] Join failed: ${String((error as any)?.message ?? error)}`, 5000);
      }
    },
  });

  plugin.addCommand({
    id: "denethor-rerun-current-note",
    name: "Denethor: Re-run research for current note",
    callback: async () => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!(activeFile instanceof TFile) || activeFile.extension !== "md") {
        new Notice("[Temporal Drift] Active file is not a note.", 3500);
        return;
      }

      const enqueued = await (plugin as any).enqueueDenethorResearchForFile?.(
        activeFile,
        "manual:command",
        true
      );

      if (enqueued) {
        new Notice(`[Temporal Drift] Enqueued Denethor research: ${activeFile.path}`, 4000);
      } else {
        new Notice("[Temporal Drift] Denethor queue is disabled or unavailable.", 4000);
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
