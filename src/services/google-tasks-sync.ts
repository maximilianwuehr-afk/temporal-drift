// ============================================================================
// Google Tasks Sync Service (Obsidian Tasks/ ↔ Google Tasks)
// ============================================================================

import { App, Notice, TAbstractFile, TFile, debounce, normalizePath, requestUrl } from "obsidian";
import { GoogleTasksToken, TemporalDriftSettings, TaskMeta } from "../types";
import { TaskIndexService } from "./task-index";

type RemoteTaskStatus = "needsAction" | "completed";

interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: RemoteTaskStatus;
  due?: string;
  updated: string;
  etag: string;
}

interface GoogleTaskList {
  id: string;
  title: string;
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

function parseObsidianPathFromNotes(notes?: string): string | null {
  if (!notes) return null;
  const m = notes.match(/Obsidian:\s*([^\n]+)/i);
  return m?.[1]?.trim() || null;
}

function encodeTaskTitle(task: { title: string; priority: "now" | "next" | "later" }): string {
  return `[${task.priority.toUpperCase()}] ${task.title}`;
}

function decodeTaskTitle(title: string): { title: string; priority: "now" | "next" | "later" } {
  const match = title.match(/^\[(NOW|NEXT|LATER)\]\s*(.*)$/i);
  if (match) {
    return {
      priority: match[1].toLowerCase() as "now" | "next" | "later",
      title: match[2],
    };
  }
  return { title, priority: "now" };
}

function canonicalStatus(done: boolean): "open" | "done" {
  return done ? "done" : "open";
}

function parseRemoteDone(status: RemoteTaskStatus): boolean {
  return status === "completed";
}

function isoDay(date: Date): string {
  return date.toISOString().split("T")[0];
}

export class GoogleTasksSyncService {
  private app: App;
  private settings: TemporalDriftSettings;
  private taskIndex: TaskIndexService;
  private token: GoogleTasksToken | null;

  private syncInProgress = false;
  private debouncedSync: (() => void) | null = null;

  private onTokenUpdate: (token: GoogleTasksToken | null) => Promise<void>;

  // OAuth
  private readonly redirectUri = "obsidian://temporal-drift-oauth";

  constructor(
    app: App,
    settings: TemporalDriftSettings,
    taskIndex: TaskIndexService,
    opts: { onTokenUpdate: (token: GoogleTasksToken | null) => Promise<void> }
  ) {
    this.app = app;
    this.settings = settings;
    this.taskIndex = taskIndex;
    this.token = settings.googleTasksToken;
    this.onTokenUpdate = opts.onTokenUpdate;

    this.setupDebouncedSync();
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.token = settings.googleTasksToken;
  }

  private setupDebouncedSync(): void {
    this.debouncedSync = debounce(() => this.syncAll(), 300, true);
  }

  isConfigured(): boolean {
    return !!(
      this.settings.googleTasksEnabled &&
      this.settings.googleTasksClientId &&
      this.settings.googleTasksClientSecret &&
      this.token
    );
  }

  getAuthUrl(): string {
    const scope = "https://www.googleapis.com/auth/tasks";
    return (
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(this.settings.googleTasksClientId)}&` +
      `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scope)}&` +
      `access_type=offline&` +
      `prompt=consent`
    );
  }

  async handleAuthCode(code: string): Promise<void> {
    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.settings.googleTasksClientId,
        client_secret: this.settings.googleTasksClientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }).toString(),
    });

    const data = response.json as any;
    const next: GoogleTasksToken = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    this.token = next;
    await this.onTokenUpdate(next);
  }

  disconnect(): Promise<void> {
    this.token = null;
    return this.onTokenUpdate(null);
  }

  triggerSync(): void {
    if (!this.settings.googleTasksEnabled) return;
    this.debouncedSync?.();
  }

  // ---------------------------------------------------------------------------
  // Remote API
  // ---------------------------------------------------------------------------

  private async refreshToken(): Promise<void> {
    if (!this.token?.refresh_token) throw new Error("No refresh token");

    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.settings.googleTasksClientId,
        client_secret: this.settings.googleTasksClientSecret,
        refresh_token: this.token.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });

    const data = response.json as any;
    const next: GoogleTasksToken = {
      ...this.token,
      access_token: data.access_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };

    this.token = next;
    await this.onTokenUpdate(next);
  }

  private async getAccessToken(): Promise<string> {
    if (!this.token) throw new Error("Not authenticated");

    // refresh if expires in next 5 minutes
    if (Date.now() > this.token.expires_at - 300_000) {
      await this.refreshToken();
    }

    return this.token.access_token;
  }

  private async fetchLists(): Promise<GoogleTaskList[]> {
    const accessToken = await this.getAccessToken();

    const listsResponse = await requestUrl({
      url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const items = (listsResponse.json as any).items ?? [];
    return items.map((l: any) => ({ id: String(l.id), title: String(l.title ?? "") }));
  }

  private async resolveListId(): Promise<string> {
    if (this.settings.googleTasksListId?.trim()) return this.settings.googleTasksListId.trim();

    const lists = await this.fetchLists();
    const first = lists[0]?.id;
    if (!first) throw new Error("No Google Task lists found");

    return first;
  }

  private async fetchRemoteTasks(listId: string): Promise<GoogleTask[]> {
    const accessToken = await this.getAccessToken();

    const tasksResponse = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&showHidden=true&maxResults=1000`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return ((tasksResponse.json as any).items ?? []) as GoogleTask[];
  }

  private async createRemoteTask(listId: string, task: TaskMeta): Promise<GoogleTask> {
    const accessToken = await this.getAccessToken();

    const response = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: encodeTaskTitle(task),
        notes: `Obsidian: ${task.path}`,
        status: task.status === "done" ? "completed" : "needsAction",
        due: task.due ? `${task.due}T00:00:00.000Z` : undefined,
      }),
    });

    return response.json as any;
  }

  private async patchRemoteTask(
    listId: string,
    taskId: string,
    patch: Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">>
  ): Promise<GoogleTask> {
    const accessToken = await this.getAccessToken();

    const response = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    });

    return response.json as any;
  }

  // ---------------------------------------------------------------------------
  // Local helpers
  // ---------------------------------------------------------------------------

  private isTaskFile(file: TFile): boolean {
    const prefix = normalizePath(this.settings.tasksFolder + "/");
    return normalizePath(file.path).startsWith(prefix);
  }

  private getLocalTaskFiles(): TFile[] {
    const prefix = normalizePath(this.settings.tasksFolder + "/");
    return this.app.vault
      .getMarkdownFiles()
      .filter((f) => normalizePath(f.path).startsWith(prefix))
      .sort((a, b) => a.path.localeCompare(b.path));
  }

  private getFrontmatter(file: TFile): Record<string, any> {
    const cache = this.app.metadataCache.getFileCache(file);
    return ((cache?.frontmatter ?? {}) as Record<string, any>) || {};
  }

  private getLocalTaskMeta(file: TFile): TaskMeta {
    const fm = this.getFrontmatter(file);
    const status = (typeof fm.status === "string" ? fm.status : "open") as "open" | "done";
    const priority = (typeof fm.priority === "string" ? fm.priority : this.settings.defaultPriority) as
      | "now"
      | "next"
      | "later";

    return {
      path: file.path,
      title: file.basename,
      status,
      priority,
      due: typeof fm.due === "string" ? fm.due : undefined,
      created: typeof fm.created === "string" ? fm.created : undefined,
      googleTaskId: typeof fm.google_task_id === "string" ? fm.google_task_id : undefined,
      googleEtag: typeof fm.google_etag === "string" ? fm.google_etag : undefined,
      googleLastSynced: typeof fm.google_last_synced === "number" ? fm.google_last_synced : undefined,
    };
  }

  private async writeSyncMeta(file: TFile, meta: { id: string; etag: string; lastSynced: number }): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      (fm as any).google_task_id = meta.id;
      (fm as any).google_etag = meta.etag;
      (fm as any).google_last_synced = meta.lastSynced;

      // also keep canonical booleans consistent
      if (typeof (fm as any).done !== "boolean" && typeof (fm as any).status === "string") {
        (fm as any).done = String((fm as any).status).toLowerCase() === "done";
      }
    });
  }

  private async applyRemoteToLocal(file: TFile, remote: GoogleTask, listId: string): Promise<void> {
    const decoded = decodeTaskTitle(remote.title);
    const done = parseRemoteDone(remote.status);

    // Ensure the remote has a mapping note.
    const notes = remote.notes ?? "";
    if (!parseObsidianPathFromNotes(notes)) {
      await this.patchRemoteTask(listId, remote.id, {
        notes: `${notes ? notes + "\n" : ""}Obsidian: ${file.path}`,
      });
    }

    // Update frontmatter
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.status = canonicalStatus(done);
      (fm as any).done = done;
      fm.priority = decoded.priority;
    });

    // Update first checkbox line (best-effort)
    await this.app.vault.process(file, (content) => {
      const lines = content.split("\n");
      const idx = lines.findIndex((l) => l.match(/^(?:\s*-\s*)?\[\s*[xX ]\s*\]/));
      const checkbox = done ? "[x]" : "[ ]";
      const priority = decoded.priority ? ` #${decoded.priority}` : "";

      if (idx >= 0) {
        const rest = lines[idx].replace(/^(\s*-?\s*)\[\s*[xX ]\s*\]\s*/, "");
        const cleaned = rest.replace(/(?:^|\s)(?:#now|#next|#later|@now|@next|@later|\[now\]|\[next\]|\[later\]|\(now\)|\(next\)|\(later\))(?=\s|$)/gi, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
        lines[idx] = `- ${checkbox} ${cleaned}${priority}`.trim();
        return lines.join("\n");
      }

      // If no checkbox, prepend one.
      const head = `- ${checkbox} ${decoded.title}${priority}`.trim();
      return `${head}\n${content}`;
    });

    await this.writeSyncMeta(file, { id: remote.id, etag: remote.etag, lastSynced: Date.now() });
  }

  private async pushLocalToRemote(file: TFile, local: TaskMeta, remote: GoogleTask, listId: string): Promise<void> {
    const next = await this.patchRemoteTask(listId, remote.id, {
      title: encodeTaskTitle(local),
      status: local.status === "done" ? "completed" : "needsAction",
      due: local.due ? `${local.due}T00:00:00.000Z` : undefined,
      notes: remote.notes ?? `Obsidian: ${local.path}`,
    });

    await this.writeSyncMeta(file, { id: next.id, etag: next.etag, lastSynced: Date.now() });
  }

  private async ensureLocalFromRemote(remote: GoogleTask): Promise<TFile | null> {
    const mappedPath = parseObsidianPathFromNotes(remote.notes);
    if (mappedPath) {
      const af = this.app.vault.getAbstractFileByPath(mappedPath);
      if (af instanceof TFile) return af;
    }

    // Create a new local task note in Tasks/
    const decoded = decodeTaskTitle(remote.title);
    const done = parseRemoteDone(remote.status);

    const safe = sanitizeFileName(decoded.title) || `Google Task ${isoDay(new Date())}`;
    const path = normalizePath(`${this.settings.tasksFolder}/${safe}.md`);

    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    const checkbox = done ? "[x]" : "[ ]";
    const priority = decoded.priority ? ` #${decoded.priority}` : "";

    const content = `---\nstatus: ${canonicalStatus(done)}\npriority: ${decoded.priority}\ndone: ${done}\ncreated: ${isoDay(new Date())}\n---\n\n- ${checkbox} ${decoded.title}${priority}\n`;

    const file = await this.app.vault.create(path, content);
    return file;
  }

  // ---------------------------------------------------------------------------
  // Main sync loop
  // ---------------------------------------------------------------------------

  async syncAll(): Promise<void> {
    if (!this.isConfigured() || this.syncInProgress) return;

    this.syncInProgress = true;

    try {
      const listId = await this.resolveListId();
      const remoteTasks = await this.fetchRemoteTasks(listId);
      const remoteById = new Map(remoteTasks.map((t) => [t.id, t]));

      // Build local set
      const localFiles = this.getLocalTaskFiles();

      // First: ensure local->remote mapping exists and reconcile
      for (const file of localFiles) {
        const local = this.getLocalTaskMeta(file);

        // Skip non-task notes without frontmatter status/priority
        if (!this.isTaskFile(file)) continue;

        // Find remote by id, or by notes mapping.
        let remote: GoogleTask | undefined;

        if (local.googleTaskId) {
          remote = remoteById.get(local.googleTaskId);
        }

        if (!remote) {
          remote = remoteTasks.find((t) => parseObsidianPathFromNotes(t.notes) === file.path);
        }

        if (!remote) {
          // Create remote
          const created = await this.createRemoteTask(listId, local);
          await this.writeSyncMeta(file, { id: created.id, etag: created.etag, lastSynced: Date.now() });
          continue;
        }

        const lastSynced = local.googleLastSynced ?? 0;
        const localModified = file.stat.mtime;
        const remoteModified = new Date(remote.updated).getTime();

        if (localModified > lastSynced && remoteModified > lastSynced) {
          // Conflict: choose local (authoritative) but log.
          console.warn("[Temporal Drift] Google Tasks conflict; choosing local", {
            path: file.path,
            localModified,
            remoteModified,
            lastSynced,
          });
        }

        if (localModified > lastSynced) {
          await this.pushLocalToRemote(file, local, remote, listId);
          continue;
        }

        if (remoteModified > lastSynced) {
          await this.applyRemoteToLocal(file, remote, listId);
        }
      }

      // Second: remote tasks that are not represented locally => create local notes.
      const localPaths = new Set(localFiles.map((f) => f.path));

      for (const remote of remoteTasks) {
        const mappedPath = parseObsidianPathFromNotes(remote.notes);
        if (mappedPath && localPaths.has(mappedPath)) continue;

        // Create local for unmapped tasks that look like ours (or all tasks, by default)
        const localFile = await this.ensureLocalFromRemote(remote);
        if (!localFile) continue;

        // Persist mapping meta and patch remote notes to include Obsidian path.
        await this.applyRemoteToLocal(localFile, remote, listId);
      }

      new Notice("[Temporal Drift] Google Tasks sync complete", 2000);
    } catch (e) {
      console.error("[Temporal Drift] Google Tasks sync failed", e);
      new Notice("[Temporal Drift] Google Tasks sync failed — see console", 4000);
    } finally {
      this.syncInProgress = false;
    }
  }

  // Convenience: list available task lists (for settings UI)
  async listTaskLists(): Promise<GoogleTaskList[]> {
    if (!this.token) return [];
    try {
      return await this.fetchLists();
    } catch {
      return [];
    }
  }

  // Listen to vault events: trigger sync on task changes
  onVaultEvent(file: TAbstractFile): void {
    if (!(file instanceof TFile)) return;
    if (!this.isTaskFile(file)) return;
    this.triggerSync();
  }
}
