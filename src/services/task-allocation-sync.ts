import { App, TFile } from "obsidian";
import { TemporalDriftSettings } from "../types";
import {
  TaskSnapshot,
  applyTaskSnapshotToTimelineLine,
  parseTaskSnapshotFromContent,
} from "./task-allocation-utils";
import { pathInFolder } from "../utils/folder-match";

const DEFAULT_DEBOUNCE_MS = 350;

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
    const snapshot = parseTaskSnapshotFromContent(content, frontmatter);

    await this.syncAllocations(taskPath, snapshot, file);
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

  private async syncAllocations(taskPath: string, snapshot: TaskSnapshot, taskFile: TFile): Promise<void> {
    const files = this.getCandidateDailyNotes(taskFile);

    for (const file of files) {
      await this.app.vault.process(file, (content) => {
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
  }
}
