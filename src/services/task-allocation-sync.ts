import { App, TFile } from "obsidian";
import { TemporalDriftSettings } from "../types";
import {
  TaskSnapshot,
  applyTaskSnapshotToTimelineLine,
  parseTaskSnapshotFromContent,
  taskLinkMatches,
} from "./task-allocation-utils";
import { pathInFolder } from "../utils/folder-match";
import { parseTaskHead, parseTimelineLine } from "../parsing/timeline";

const DEFAULT_DEBOUNCE_MS = 350;

type TaskSourceRef = {
  path: string; // vault-relative daily note path
  dateKey: string; // YYYY-MM-DD (best-effort)
  time: string; // HH:mm (start time)
};

function dateKeyFromPath(path: string): string {
  const base = path.split("/").pop() ?? path;
  const m = base.match(/(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? "";
}

function timeKeyToMinutes(time: string): number {
  const m = time.match(/(\d{1,2}):(\d{2})/);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

function pickNewerSource(current: TaskSourceRef | null, next: TaskSourceRef): TaskSourceRef {
  if (!current) return next;

  // Prefer newer day.
  if (next.dateKey && current.dateKey && next.dateKey !== current.dateKey) {
    return next.dateKey > current.dateKey ? next : current;
  }

  // If date is missing, fall back to lexical path as a stable tie-break.
  if ((!next.dateKey || !current.dateKey) && next.path !== current.path) {
    return next.path > current.path ? next : current;
  }

  // Same day: prefer later time.
  const a = timeKeyToMinutes(current.time);
  const b = timeKeyToMinutes(next.time);
  if (Number.isFinite(a) && Number.isFinite(b) && a !== b) {
    return b > a ? next : current;
  }

  return current;
}

function findTaskSourceInDailyNote(content: string, taskPath: string): { time: string } | null {
  for (const line of content.split("\n")) {
    const parsed = parseTimelineLine(line);
    if (!parsed) continue;

    const head = parsed.headRaw;
    if (!parseTaskHead(head).isTask) continue;

    const link = head.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    if (!link?.[1]) continue;

    if (!taskLinkMatches(link[1].trim(), taskPath)) continue;

    // Ranges => use start
    const time = parsed.timeText.split("–")[0]?.trim() || parsed.timeText;
    return { time };
  }

  return null;
}

export class TaskAllocationSync {
  private app: App;
  private settings: TemporalDriftSettings;

  // Debounce per task file path.
  private pendingTimers = new Map<string, number>();

  // Serialize writes across tasks to avoid concurrent edits to the same daily note.
  private queue: Promise<void> = Promise.resolve();

  constructor(app: App, settings: TemporalDriftSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
  }

  /**
   * Called from vault events (create/modify/rename). This method is intentionally fast:
   * it debounces and serializes all heavy work to prevent missed updates and write races.
   */
  async syncFromTaskFile(file: TFile): Promise<void> {
    if (file.extension !== "md") return;
    if (!pathInFolder(file.path, this.settings.tasksFolder, ["Tasks"])) return;

    this.scheduleTaskSync(file.path, DEFAULT_DEBOUNCE_MS);
  }

  private scheduleTaskSync(taskPath: string, debounceMs: number): void {
    const existing = this.pendingTimers.get(taskPath);
    if (existing) window.clearTimeout(existing);

    const handle = window.setTimeout(() => {
      this.pendingTimers.delete(taskPath);
      this.enqueue(() => this.runTaskSync(taskPath));
    }, debounceMs);

    this.pendingTimers.set(taskPath, handle);
  }

  private enqueue(fn: () => Promise<void>): void {
    this.queue = this.queue
      .then(fn)
      .catch((err) => {
        console.error("[Temporal Drift] TaskAllocationSync failed", err);
      });
  }

  private async runTaskSync(taskPath: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(taskPath);
    if (!(file instanceof TFile)) return;

    const content = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const snapshot = parseTaskSnapshotFromContent(content, frontmatter, {
      statusKey: this.settings.taskFieldStatus,
      doneKey: this.settings.taskFieldDone,
      priorityKey: this.settings.taskFieldPriority,
    });

    const source = await this.syncAllocations(taskPath, snapshot, file);

    // Persist a pointer back to where the task is allocated (daily note).
    // Stored as a clickable wikilink in Obsidian Properties.
    if (source) {
      await this.updateTaskSourceFrontmatter(file, source);
    }
  }

  private getCandidateDailyNotes(taskFile: TFile): TFile[] {
    // Prefer backlinks (fast) to avoid scanning the entire daily notes history.
    const getBacklinksForFile = (this.app.metadataCache as any).getBacklinksForFile as
      | ((file: TFile) => { data?: Record<string, unknown> })
      | undefined;

    const backlinks = getBacklinksForFile?.(taskFile);
    const sources = backlinks?.data ? Object.keys(backlinks.data) : [];

    const candidates: TFile[] = [];

    for (const path of sources) {
      const f = this.app.vault.getAbstractFileByPath(path);
      if (f instanceof TFile && f.extension === "md") {
        if (pathInFolder(f.path, this.settings.dailyNotesFolder, ["Daily notes"])) {
          candidates.push(f);
        }
      }
    }

    if (candidates.length > 0) return candidates;

    // Fallback for cold metadata cache / new vaults.
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => pathInFolder(f.path, this.settings.dailyNotesFolder, ["Daily notes"]));
  }

  private async syncAllocations(
    taskPath: string,
    snapshot: TaskSnapshot,
    taskFile: TFile
  ): Promise<TaskSourceRef | null> {
    const files = this.getCandidateDailyNotes(taskFile);

    let bestSource: TaskSourceRef | null = null;

    for (const file of files) {
      await this.app.vault.process(file, (content) => {
        const maybeSource = findTaskSourceInDailyNote(content, taskPath);
        if (maybeSource) {
          bestSource = pickNewerSource(bestSource, {
            path: file.path,
            dateKey: dateKeyFromPath(file.path),
            time: maybeSource.time,
          });
        }

        const lines = content.split("\n");
        let changed = false;

        const nextLines = lines.map((line) => {
          const nextLine = applyTaskSnapshotToTimelineLine(line, taskPath, snapshot);
          if (nextLine !== line) changed = true;
          return nextLine;
        });

        return changed ? nextLines.join("\n") : content;
      });
    }

    return bestSource;
  }

  private async updateTaskSourceFrontmatter(taskFile: TFile, source: TaskSourceRef): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(taskFile);
    const fm = cache?.frontmatter as Record<string, unknown> | undefined;

    const nextLinkTarget = source.path.replace(/\.md$/i, "");
    const nextLink = `[[${nextLinkTarget}]]`;

    const sourceKey = this.settings.taskFieldSource || "td_source";
    const sourceTimeKey = this.settings.taskFieldSourceTime || "td_source_time";

    const currentLinkRaw = fm?.[sourceKey];
    const currentTimeRaw = fm?.[sourceTimeKey];

    const currentLink = typeof currentLinkRaw === "string" ? currentLinkRaw.trim() : "";
    const currentTime = typeof currentTimeRaw === "string" ? currentTimeRaw.trim() : "";

    if (currentLink === nextLink && currentTime === source.time) {
      return;
    }

    await this.app.fileManager.processFrontMatter(taskFile, (frontmatter) => {
      (frontmatter as any)[sourceKey] = nextLink;
      (frontmatter as any)[sourceTimeKey] = source.time;
    });
  }
}
