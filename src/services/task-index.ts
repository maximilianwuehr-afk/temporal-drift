// ============================================================================
// Task Index Service - O(1) Task Queries
// ============================================================================

import { App, TFile, CachedMetadata } from "obsidian";
import { TemporalDriftSettings, SettingsAware, TaskMeta } from "../types";

// File-level mutex for race condition prevention
const FILE_LOCKS = new Map<string, Promise<void>>();

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const existing = FILE_LOCKS.get(path) ?? Promise.resolve();
  let release: () => void;
  const lock = new Promise<void>((r) => (release = r));
  FILE_LOCKS.set(path, existing.then(() => lock));

  try {
    await existing;
    return await fn();
  } finally {
    release!();
    if (FILE_LOCKS.get(path) === lock) FILE_LOCKS.delete(path);
  }
}

export class TaskIndexService implements SettingsAware {
  private app: App;
  private settings: TemporalDriftSettings;

  // Index by priority for fast queries
  private byPriority = new Map<string, Set<string>>();
  // Index by status
  private byStatus = new Map<string, Set<string>>();
  // Full metadata by path
  private metadata = new Map<string, TaskMeta>();

  private initialized = false;

  constructor(app: App, settings: TemporalDriftSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
  }

  /**
   * Build the task index from vault
   */
  async buildIndex(): Promise<void> {
    this.clear();

    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(this.settings.tasksFolder));

    for (const file of files) {
      await this.indexFile(file);
    }

    this.initialized = true;
  }

  /**
   * Clear all indexes
   */
  private clear(): void {
    this.byPriority.clear();
    this.byStatus.clear();
    this.metadata.clear();
  }

  /**
   * Index a single file
   */
  private async indexFile(file: TFile): Promise<void> {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return;

    const fm = cache.frontmatter;
    if (!fm) return;

    const meta: TaskMeta = {
      path: file.path,
      title: file.basename,
      status: fm.status || "open",
      priority: fm.priority || this.settings.defaultPriority,
      due: fm.due,
      created: fm.created,
    };

    this.metadata.set(file.path, meta);

    // Index by priority
    if (!this.byPriority.has(meta.priority)) {
      this.byPriority.set(meta.priority, new Set());
    }
    this.byPriority.get(meta.priority)!.add(file.path);

    // Index by status
    if (!this.byStatus.has(meta.status)) {
      this.byStatus.set(meta.status, new Set());
    }
    this.byStatus.get(meta.status)!.add(file.path);
  }

  /**
   * Remove a file from index
   */
  private removeFromIndex(path: string): void {
    const meta = this.metadata.get(path);
    if (!meta) return;

    this.byPriority.get(meta.priority)?.delete(path);
    this.byStatus.get(meta.status)?.delete(path);
    this.metadata.delete(path);
  }

  /**
   * Handle file modification - reindex
   */
  async onFileModify(file: TFile): Promise<void> {
    if (!file.path.startsWith(this.settings.tasksFolder)) return;
    this.removeFromIndex(file.path);
    await this.indexFile(file);
  }

  /**
   * Handle file deletion
   */
  onFileDelete(file: TFile): void {
    this.removeFromIndex(file.path);
  }

  /**
   * Handle file rename
   */
  async onFileRename(file: TFile, oldPath: string): Promise<void> {
    this.removeFromIndex(oldPath);
    if (file.path.startsWith(this.settings.tasksFolder)) {
      await this.indexFile(file);
    }
  }

  /**
   * Get tasks by priority
   */
  getByPriority(priority: string): TaskMeta[] {
    const paths = this.byPriority.get(priority) || new Set();
    return [...paths].map((p) => this.metadata.get(p)!).filter(Boolean);
  }

  /**
   * Get tasks by status
   */
  getByStatus(status: string): TaskMeta[] {
    const paths = this.byStatus.get(status) || new Set();
    return [...paths].map((p) => this.metadata.get(p)!).filter(Boolean);
  }

  /**
   * Get all open tasks grouped by priority
   */
  getOpenTasksByPriority(): Record<string, TaskMeta[]> {
    const openPaths = this.byStatus.get("open") || new Set();
    const result: Record<string, TaskMeta[]> = {
      now: [],
      next: [],
      later: [],
    };

    for (const path of openPaths) {
      const meta = this.metadata.get(path);
      if (meta) {
        result[meta.priority] = result[meta.priority] || [];
        result[meta.priority].push(meta);
      }
    }

    // Sort each group by due date if present
    for (const priority of Object.keys(result)) {
      result[priority].sort((a, b) => {
        if (!a.due && !b.due) return 0;
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
      });
    }

    return result;
  }

  /**
   * Get task metadata by path
   */
  getTask(path: string): TaskMeta | undefined {
    return this.metadata.get(path);
  }

  /**
   * Toggle task status with file lock
   */
  async toggleStatus(path: string, newStatus: "open" | "done"): Promise<void> {
    await withFileLock(path, async () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return;

      await this.app.vault.process(file, (content) => {
        // Update status in frontmatter
        return content.replace(/^(---\n[\s\S]*?status:\s*)\w+/m, `$1${newStatus}`);
      });
    });
  }

  /**
   * Update task priority with file lock
   */
  async updatePriority(path: string, newPriority: "now" | "next" | "later"): Promise<void> {
    await withFileLock(path, async () => {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (!(file instanceof TFile)) return;

      await this.app.vault.process(file, (content) => {
        // Update priority in frontmatter
        if (content.match(/^(---\n[\s\S]*?priority:\s*)\w+/m)) {
          return content.replace(/^(---\n[\s\S]*?priority:\s*)\w+/m, `$1${newPriority}`);
        } else {
          // Add priority if not present
          return content.replace(/^(---\n)/, `$1priority: ${newPriority}\n`);
        }
      });
    });
  }

  /**
   * Create a new task
   */
  async createTask(title: string, priority?: "now" | "next" | "later"): Promise<TFile> {
    const safeName = title.replace(/[\\/:*?"<>|]/g, "-");
    const path = `${this.settings.tasksFolder}/${safeName}.md`;

    const content = `---
status: open
priority: ${priority || this.settings.defaultPriority}
created: ${new Date().toISOString().split("T")[0]}
---

# ${title}
`;

    const file = await this.app.vault.create(path, content);
    await this.indexFile(file);
    return file;
  }

  /**
   * Check if index is ready
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get total task counts
   */
  getCounts(): { total: number; open: number; done: number; byPriority: Record<string, number> } {
    const openPaths = this.byStatus.get("open") || new Set();
    const donePaths = this.byStatus.get("done") || new Set();

    return {
      total: this.metadata.size,
      open: openPaths.size,
      done: donePaths.size,
      byPriority: {
        now: (this.byPriority.get("now") || new Set()).size,
        next: (this.byPriority.get("next") || new Set()).size,
        later: (this.byPriority.get("later") || new Set()).size,
      },
    };
  }
}
