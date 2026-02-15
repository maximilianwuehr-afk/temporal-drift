// ============================================================================
// Google Tasks Sync Service (Obsidian Tasks/ ↔ Google Tasks)
// ============================================================================

import { App, Notice, TAbstractFile, TFile, debounce, normalizePath } from "obsidian";

import { GoogleTasksToken, TemporalDriftSettings, TaskMeta, GoogleTasksSyncStatus, GoogleTasksSyncStats } from "../types";
import { GoogleAuthSession } from "./google/auth/google-auth-session";
import { GoogleTasksRemoteClient } from "./google/tasks/google-tasks-remote-client";
import { LocalTaskReconciliation } from "./google/tasks/local-task-reconciliation";
import { emptyPreviewCounts, emptySyncStats, parseObsidianPathFromNotes } from "./google/tasks/task-codec";
import {
  GoogleTask,
  GoogleTaskList,
  GoogleTasksPreviewAction,
  GoogleTasksPreviewItem,
  GoogleTasksPreviewResult,
} from "./google/tasks/types";
import { TaskIndexService } from "./task-index";
import { decideSyncPair } from "./google-sync-planner";

export type {
  GoogleTaskList,
  GoogleTasksPreviewAction,
  GoogleTasksPreviewItem,
  GoogleTasksPreviewResult,
};

export class GoogleTasksSyncService {
  private app: App;
  private settings: TemporalDriftSettings;
  private taskIndex: TaskIndexService;
  private token: GoogleTasksToken | null;
  private auth: GoogleAuthSession;
  private remoteClient: GoogleTasksRemoteClient;
  private localReconciliation: LocalTaskReconciliation;

  private syncInProgress = false;
  private debouncedSync: (() => void) | null = null;

  private status: GoogleTasksSyncStatus = {
    state: "idle",
    inProgress: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastSuccessAt: null,
    lastError: null,
    lastStats: null,
  };

  private onTokenUpdate: (token: GoogleTasksToken | null) => Promise<void>;
  private onStatusUpdate?: (status: GoogleTasksSyncStatus) => void | Promise<void>;

  // OAuth
  // Use loopback redirect (http://127.0.0.1:<port>/oauth2callback) + PKCE.
  // Custom URI schemes are restricted by Google and are not reliable.

  constructor(
    app: App,
    settings: TemporalDriftSettings,
    taskIndex: TaskIndexService,
    opts: {
      onTokenUpdate: (token: GoogleTasksToken | null) => Promise<void>;
      onStatusUpdate?: (status: GoogleTasksSyncStatus) => void | Promise<void>;
    }
  ) {
    this.app = app;
    this.settings = settings;
    this.taskIndex = taskIndex;
    this.token = settings.googleTasksToken;
    this.onTokenUpdate = opts.onTokenUpdate;
    this.onStatusUpdate = opts.onStatusUpdate;

    this.auth = new GoogleAuthSession({
      scope: "https://www.googleapis.com/auth/tasks",
      token: this.token,
      getClientId: () => this.settings.googleTasksClientId,
      getClientSecret: () => this.settings.googleTasksClientSecret,
      onTokenUpdate: async (token) => {
        this.token = token as GoogleTasksToken | null;
        await this.onTokenUpdate(this.token);
      },
    });

    this.remoteClient = new GoogleTasksRemoteClient({
      auth: this.auth,
      getListId: () => this.settings.googleTasksListId,
      onTokenRefresh: () => {
        this.token = this.auth.getToken() as GoogleTasksToken | null;
      },
    });

    this.localReconciliation = new LocalTaskReconciliation({
      app: this.app,
      getTasksFolder: () => this.settings.tasksFolder,
      getTaskFieldKeys: () => ({
        statusKey: this.settings.taskFieldStatus || "status",
        doneKey: this.settings.taskFieldDone || "done",
        priorityKey: this.settings.taskFieldPriority || "priority",
      }),
      getFrontmatter: this.getFrontmatter.bind(this),
      getLocalTaskMeta: this.getLocalTaskMeta.bind(this),
      computeSyncStamp: this.computeSyncStamp.bind(this),
      writeSyncMeta: this.writeSyncMeta.bind(this),
      patchRemoteTask: this.patchRemoteTask.bind(this),
      fetchRemoteTaskById: this.fetchRemoteTaskById.bind(this),
      logSyncDecision: this.logSyncDecision.bind(this),
      getHttpStatus: this.getHttpStatus.bind(this),
    });

    this.setupDebouncedSync();
    this.emitStatus();
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.token = settings.googleTasksToken;
    this.auth.updateToken(this.token);
  }

  getStatus(): GoogleTasksSyncStatus {
    return {
      ...this.status,
      lastStats: this.status.lastStats ? { ...this.status.lastStats } : null,
    };
  }

  private emitStatus(): void {
    try {
      const current = this.getStatus();
      void this.onStatusUpdate?.(current);
    } catch {
      // status hook should never break sync flow
    }
  }

  private updateStatus(patch: Partial<GoogleTasksSyncStatus>): void {
    this.status = {
      ...this.status,
      ...patch,
    };
    this.emitStatus();
  }

  private setupDebouncedSync(): void {
    this.debouncedSync = debounce(() => this.syncAll(), 300, true);
  }

  isConfigured(): boolean {
    return !!(this.settings.googleTasksEnabled && this.settings.googleTasksClientId && this.auth.isAuthenticated());
  }

  /**
   * Starts a loopback OAuth flow (PKCE).
   */
  async beginAuthFlow(openUrl: (url: string) => void): Promise<void> {
    if (!this.settings.googleTasksClientId) {
      new Notice("[Temporal Drift] Missing Google Client ID", 4000);
      return;
    }

    await this.auth.beginAuthFlow(openUrl);
  }

  async disconnect(): Promise<void> {
    this.updateStatus({
      state: "idle",
      inProgress: false,
      lastError: null,
    });

    await this.auth.disconnect();
    this.token = null;
  }

  triggerSync(): void {
    if (!this.settings.googleTasksEnabled) return;
    this.debouncedSync?.();
  }

  // ---------------------------------------------------------------------------
  // Remote API
  // ---------------------------------------------------------------------------

  private async fetchLists(): Promise<GoogleTaskList[]> {
    return await this.remoteClient.listTaskLists();
  }

  private async resolveListId(): Promise<string> {
    return await this.remoteClient.resolveListId();
  }

  private async fetchRemoteTasks(listId: string): Promise<GoogleTask[]> {
    return await this.remoteClient.listTasks(listId);
  }

  private async createRemoteTask(listId: string, task: TaskMeta): Promise<GoogleTask> {
    return await this.remoteClient.createTask(listId, task);
  }

  private async patchRemoteTask(
    listId: string,
    taskId: string,
    patch: Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">>,
    opts?: { ifMatchEtag?: string }
  ): Promise<GoogleTask> {
    return await this.remoteClient.patchTask(listId, taskId, patch, opts);
  }

  private async fetchRemoteTaskById(listId: string, taskId: string): Promise<GoogleTask> {
    return await this.remoteClient.getTaskById(listId, taskId);
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

    const statusKey = this.settings.taskFieldStatus || "status";
    const priorityKey = this.settings.taskFieldPriority || "priority";
    const dueKey = this.settings.taskFieldDue || "due";
    const createdKey = this.settings.taskFieldCreated || "created";

    const statusRaw = (fm as any)[statusKey];
    const priorityRaw = (fm as any)[priorityKey];

    const status = (typeof statusRaw === "string" ? statusRaw : "open") as "open" | "done";
    const priority = (typeof priorityRaw === "string" ? priorityRaw : this.settings.defaultPriority) as
      | "now"
      | "next"
      | "later";

    const dueRaw = (fm as any)[dueKey];
    const createdRaw = (fm as any)[createdKey];

    return {
      path: file.path,
      title: file.basename,
      status,
      priority,
      due: typeof dueRaw === "string" ? dueRaw : undefined,
      created: typeof createdRaw === "string" ? createdRaw : undefined,
      googleTaskId: typeof fm.google_task_id === "string" ? fm.google_task_id : undefined,
      googleEtag: typeof fm.google_etag === "string" ? fm.google_etag : undefined,
      googleLastSynced: typeof fm.google_last_synced === "number" ? fm.google_last_synced : undefined,
    };
  }

  private computeSyncStamp(file: TFile, local?: TaskMeta): number {
    const now = Date.now();
    const previous = local?.googleLastSynced ?? 0;
    // Cushion above current mtime to avoid immediate re-push after metadata writes.
    return Math.max(now, file.stat.mtime + 2000, previous + 1);
  }

  private async writeSyncMeta(file: TFile, meta: { id: string; etag: string; lastSynced: number }): Promise<void> {
    const current = this.getFrontmatter(file);
    const currentId = typeof current.google_task_id === "string" ? current.google_task_id : "";
    const currentEtag = typeof current.google_etag === "string" ? current.google_etag : "";
    const currentLastSynced = typeof current.google_last_synced === "number" ? current.google_last_synced : 0;

    const statusKey = this.settings.taskFieldStatus || "status";
    const doneKey = this.settings.taskFieldDone || "done";

    const doneFromStatus = typeof (current as any)[statusKey] === "string" ? String((current as any)[statusKey]).toLowerCase() === "done" : undefined;
    const doneNeedsWrite = typeof (current as any)[doneKey] !== "boolean" && typeof doneFromStatus === "boolean";

    const idChanged = currentId !== meta.id;
    const etagChanged = currentEtag !== meta.etag;
    const syncChanged = currentLastSynced !== meta.lastSynced;

    if (!idChanged && !etagChanged && !syncChanged && !doneNeedsWrite) {
      return;
    }

    await this.app.fileManager.processFrontMatter(file, (fm) => {
      (fm as any).google_task_id = meta.id;
      (fm as any).google_etag = meta.etag;
      (fm as any).google_last_synced = meta.lastSynced;

      // also keep done boolean consistent with status
      const statusKey = this.settings.taskFieldStatus || "status";
      const doneKey = this.settings.taskFieldDone || "done";
      if (typeof (fm as any)[doneKey] !== "boolean" && typeof (fm as any)[statusKey] === "string") {
        (fm as any)[doneKey] = String((fm as any)[statusKey]).toLowerCase() === "done";
      }
    });
  }

  // moved to LocalTaskReconciliation

  private remoteMatchesLocal(local: TaskMeta, remote: GoogleTask): boolean {
    return this.localReconciliation.remoteMatchesLocal(local, remote);
  }

  private logSyncDecision(action: string, payload: Record<string, unknown>): void {
    console.info("[Temporal Drift] Google Tasks sync decision", {
      action,
      ...payload,
    });
  }

  private getHttpStatus(error: unknown): number | null {
    const e = error as any;
    if (typeof e?.status === "number") return e.status;
    if (typeof e?.statusCode === "number") return e.statusCode;
    if (typeof e?.response?.status === "number") return e.response.status;
    const msg = String(e?.message ?? "");
    const m = msg.match(/\b(?:HTTP|status(?: code)?)[^\d]*(\d{3})\b/i);
    if (m) return Number(m[1]);
    return null;
  }

  private async applyRemoteToLocal(file: TFile, remote: GoogleTask, listId: string): Promise<void> {
    const decoded = decodeTaskTitle(remote.title);
    const done = parseRemoteDone(remote.status);

    // Ensure the remote has up-to-date mapping note.
    const mappedPath = parseObsidianPathFromNotes(remote.notes);
    if (mappedPath !== file.path) {
      const next = await this.patchRemoteTask(
        listId,
        remote.id,
        { notes: buildObsidianNotes(file.path, remote.notes) },
        { ifMatchEtag: remote.etag }
      );
      remote = next;
    }

    // Update frontmatter only when it actually changes.
    const statusKey = this.settings.taskFieldStatus || "status";
    const doneKey = this.settings.taskFieldDone || "done";
    const priorityKey = this.settings.taskFieldPriority || "priority";

    const fm = this.getFrontmatter(file);
    const nextStatus = canonicalStatus(done);
    const nextDone = done;
    const nextPriority = decoded.priority;

    const needsFrontmatterUpdate =
      String((fm as any)[statusKey] ?? "") !== nextStatus ||
      Boolean((fm as any)[doneKey] ?? false) !== nextDone ||
      String((fm as any)[priorityKey] ?? "") !== nextPriority;

    if (needsFrontmatterUpdate) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        (frontmatter as any)[statusKey] = nextStatus;
        (frontmatter as any)[doneKey] = nextDone;
        (frontmatter as any)[priorityKey] = nextPriority;
      });
    }

    // Update first checkbox line (best-effort) without write-churn on no-op.
    const original = await this.app.vault.read(file);
    const lines = original.split("\n");
    const idx = lines.findIndex((l) => l.match(/^(?:\s*-\s*)?\[\s*[xX ]\s*\]/));
    const checkbox = done ? "[x]" : "[ ]";
    const priority = decoded.priority ? ` #${decoded.priority}` : "";

    let nextContent = original;
    if (idx >= 0) {
      const rest = lines[idx].replace(/^(\s*-?\s*)\[\s*[xX ]\s*\]\s*/, "");
      const cleaned = rest
        .replace(/(?:^|\s)(?:#now|#next|#later|@now|@next|@later|\[now\]|\[next\]|\[later\]|\(now\)|\(next\)|\(later\))(?=\s|$)/gi, " ")
        .replace(/\s{2,}/g, " ")
        .trim();
      lines[idx] = `- ${checkbox} ${cleaned}${priority}`.trim();
      nextContent = lines.join("\n");
    } else {
      const head = `- ${checkbox} ${decoded.title}${priority}`.trim();
      nextContent = `${head}\n${original}`;
    }

    if (nextContent !== original) {
      await this.app.vault.modify(file, nextContent);
    }

    const localAfter = this.getLocalTaskMeta(file);
    await this.writeSyncMeta(file, {
      id: remote.id,
      etag: remote.etag,
      lastSynced: this.computeSyncStamp(file, localAfter),
    });
  }

  private async pushLocalToRemote(file: TFile, local: TaskMeta, remote: GoogleTask, listId: string): Promise<GoogleTask> {
    const patch = this.remotePayloadFromLocal(local, remote);

    // Avoid remote write churn when already in desired state.
    if (this.remoteMatchesLocal(local, remote)) {
      await this.writeSyncMeta(file, {
        id: remote.id,
        etag: remote.etag,
        lastSynced: this.computeSyncStamp(file, local),
      });
      this.logSyncDecision("remote_noop", { path: file.path, taskId: remote.id });
      return remote;
    }

    try {
      const next = await this.patchRemoteTask(listId, remote.id, patch, {
        ifMatchEtag: local.googleEtag || remote.etag,
      });

      await this.writeSyncMeta(file, {
        id: next.id,
        etag: next.etag,
        lastSynced: this.computeSyncStamp(file, local),
      });

      this.logSyncDecision("remote_patch", {
        path: file.path,
        taskId: next.id,
        reason: "local_changed",
      });

      return next;
    } catch (error) {
      const status = this.getHttpStatus(error);

      // ETag race: fetch fresh, then deterministically apply local-wins once.
      if (status === 409 || status === 412) {
        this.logSyncDecision("remote_etag_conflict", {
          path: file.path,
          taskId: remote.id,
          status,
          strategy: "local_wins_retry_once",
        });

        const latest = await this.fetchRemoteTaskById(listId, remote.id);
        const retried = await this.patchRemoteTask(listId, remote.id, this.remotePayloadFromLocal(local, latest), {
          ifMatchEtag: latest.etag,
        });

        await this.writeSyncMeta(file, {
          id: retried.id,
          etag: retried.etag,
          lastSynced: this.computeSyncStamp(file, local),
        });

        this.logSyncDecision("remote_patch_retry", {
          path: file.path,
          taskId: retried.id,
        });

        return retried;
      }

      throw error;
    }
  }

  private suggestLocalPathForRemote(remote: GoogleTask, occupied?: Set<string>): string {
    const decoded = decodeTaskTitle(remote.title);
    const safe = sanitizeFileName(decoded.title) || `Google Task ${isoDay(new Date())}`;

    let path = normalizePath(`${this.settings.tasksFolder}/${safe}.md`);
    const baseId = sanitizeFileName(remote.id).slice(0, 8) || String(Date.now());
    let bump = 0;

    const isTaken = (candidate: string): boolean => {
      if (occupied?.has(candidate)) return true;
      return this.app.vault.getAbstractFileByPath(candidate) instanceof TFile;
    };

    while (isTaken(path)) {
      bump += 1;
      const suffix = bump === 1 ? baseId : `${baseId}-${bump}`;
      path = normalizePath(`${this.settings.tasksFolder}/${safe} (${suffix}).md`);
    }

    return path;
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

    const path = this.suggestLocalPathForRemote(remote);

    const checkbox = done ? "[x]" : "[ ]";
    const priority = decoded.priority ? ` #${decoded.priority}` : "";

    const content = `---\nstatus: ${canonicalStatus(done)}\npriority: ${decoded.priority}\ndone: ${done}\ncreated: ${isoDay(new Date())}\n---\n\n- ${checkbox} ${decoded.title}${priority}\n`;

    const file = await this.app.vault.create(path, content);
    return file;
  }

  // ---------------------------------------------------------------------------
  // Preview + main sync loop
  // ---------------------------------------------------------------------------

  async previewSyncPlan(): Promise<GoogleTasksPreviewResult> {
    if (!this.isConfigured()) {
      throw new Error("Google Tasks sync is not configured");
    }

    const listId = await this.resolveListId();
    const remoteTasks = await this.fetchRemoteTasks(listId);
    const remoteById = new Map(remoteTasks.map((t) => [t.id, t]));

    const counts = emptyPreviewCounts();
    const items: GoogleTasksPreviewItem[] = [];

    const localFiles = this.getLocalTaskFiles();
    const occupiedLocalPaths = new Set(localFiles.map((f) => f.path));

    for (const file of localFiles) {
      const local = this.getLocalTaskMeta(file);
      if (!this.isTaskFile(file)) continue;

      let remote: GoogleTask | undefined;

      if (local.googleTaskId) {
        remote = remoteById.get(local.googleTaskId);
      }

      if (!remote) {
        remote = remoteTasks.find((t) => parseObsidianPathFromNotes(t.notes) === file.path);
      }

      if (!remote) {
        counts.create_remote += 1;
        items.push({ action: "create_remote", path: file.path, reason: "remote_missing" });
        continue;
      }

      const lastSynced = local.googleLastSynced ?? 0;
      const localModified = file.stat.mtime;
      const remoteModified = new Date(remote.updated).getTime();
      const statesAlreadyMatch = this.remoteMatchesLocal(local, remote);

      const decision = decideSyncPair({
        remoteExists: true,
        statesMatch: statesAlreadyMatch,
        localModified,
        remoteModified,
        lastSynced,
      });

      if (decision.conflict) {
        counts.conflict += 1;
      }

      if (decision.action === "push_local") {
        counts.update_remote += 1;
        items.push({
          action: "update_remote",
          path: file.path,
          taskId: remote.id,
          reason: decision.reason,
        });
        continue;
      }

      if (decision.action === "pull_remote") {
        counts.update_local += 1;
        items.push({
          action: "update_local",
          path: file.path,
          taskId: remote.id,
          reason: decision.reason,
        });
        continue;
      }

      counts.noop += 1;
      items.push({
        action: "noop",
        path: file.path,
        taskId: remote.id,
        reason: decision.reason,
      });
    }

    for (const remote of remoteTasks) {
      const mappedPath = parseObsidianPathFromNotes(remote.notes);
      if (mappedPath && occupiedLocalPaths.has(mappedPath)) continue;

      const suggested = this.suggestLocalPathForRemote(remote, occupiedLocalPaths);
      occupiedLocalPaths.add(suggested);

      counts.create_local += 1;
      items.push({
        action: "create_local",
        path: suggested,
        taskId: remote.id,
        reason: "remote_unmapped",
      });
    }

    return {
      listId,
      generatedAt: Date.now(),
      counts,
      items,
    };
  }

  formatPreviewSummary(preview: GoogleTasksPreviewResult): string {
    const c = preview.counts;
    return [
      `Google Tasks preview (${new Date(preview.generatedAt).toLocaleString()})`,
      `List: ${preview.listId}`,
      `create_remote: ${c.create_remote}`,
      `update_remote: ${c.update_remote}`,
      `update_local: ${c.update_local}`,
      `create_local: ${c.create_local}`,
      `conflict: ${c.conflict}`,
      `noop: ${c.noop}`,
    ].join("\n");
  }

  async syncAll(): Promise<void> {
    if (!this.isConfigured() || this.syncInProgress) return;

    this.syncInProgress = true;

    const stats: GoogleTasksSyncStats = emptySyncStats();
    const startedAt = Date.now();

    this.updateStatus({
      state: "running",
      inProgress: true,
      lastStartedAt: startedAt,
      lastError: null,
    });

    try {
      const listId = await this.resolveListId();
      const remoteTasks = await this.fetchRemoteTasks(listId);
      const remoteById = new Map(remoteTasks.map((t) => [t.id, t]));

      // Build local set
      const localFiles = this.getLocalTaskFiles();

      // First: ensure local->remote mapping exists and reconcile.
      for (const file of localFiles) {
        const local = this.getLocalTaskMeta(file);
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
          const created = await this.createRemoteTask(listId, local);
          await this.writeSyncMeta(file, {
            id: created.id,
            etag: created.etag,
            lastSynced: this.computeSyncStamp(file, local),
          });
          stats.remoteCreates += 1;
          this.logSyncDecision("remote_create", { path: file.path, taskId: created.id });
          continue;
        }

        const lastSynced = local.googleLastSynced ?? 0;
        const localModified = file.stat.mtime;
        const remoteModified = new Date(remote.updated).getTime();
        const statesAlreadyMatch = this.remoteMatchesLocal(local, remote);

        const decision = decideSyncPair({
          remoteExists: true,
          statesMatch: statesAlreadyMatch,
          localModified,
          remoteModified,
          lastSynced,
        });

        if (decision.conflict) {
          stats.conflicts += 1;
          this.logSyncDecision("conflict_detected", {
            path: file.path,
            taskId: remote.id,
            localModified,
            remoteModified,
            lastSynced,
            decision: decision.reason,
            strategy: "local_wins",
          });
        }

        if (decision.action === "push_local") {
          const before = local.googleEtag ?? remote.etag;
          const next = await this.pushLocalToRemote(file, local, remote, listId);
          if (next.etag !== before) stats.remotePatches += 1;
          else stats.remoteNoops += 1;
          continue;
        }

        if (decision.action === "pull_remote") {
          await this.applyRemoteToLocal(file, remote, listId);
          stats.localPulls += 1;
          this.logSyncDecision("local_apply", {
            path: file.path,
            taskId: remote.id,
            reason: decision.reason,
          });
          continue;
        }

        if (decision.action === "noop") {
          await this.writeSyncMeta(file, {
            id: remote.id,
            etag: remote.etag,
            lastSynced: this.computeSyncStamp(file, local),
          });

          if (decision.reason.startsWith("local_") || decision.reason === "both_changed_but_equal") {
            stats.remoteNoops += 1;
          } else {
            stats.localNoops += 1;
          }

          this.logSyncDecision("sync_noop", {
            path: file.path,
            taskId: remote.id,
            reason: decision.reason,
          });
          continue;
        }
      }

      // Second: remote tasks that are not represented locally => create local notes.
      const localPaths = new Set(this.getLocalTaskFiles().map((f) => f.path));

      for (const remote of remoteTasks) {
        const mappedPath = parseObsidianPathFromNotes(remote.notes);
        if (mappedPath && localPaths.has(mappedPath)) continue;

        const localFile = await this.ensureLocalFromRemote(remote);
        if (!localFile) continue;

        const existed = localPaths.has(localFile.path);
        await this.applyRemoteToLocal(localFile, remote, listId);
        if (!existed) {
          localPaths.add(localFile.path);
          stats.localCreates += 1;
          this.logSyncDecision("local_create", {
            taskId: remote.id,
            path: localFile.path,
          });
        }
      }

      this.logSyncDecision("sync_summary", stats);

      const finishedAt = Date.now();
      this.updateStatus({
        state: "success",
        inProgress: false,
        lastFinishedAt: finishedAt,
        lastSuccessAt: finishedAt,
        lastError: null,
        lastStats: { ...stats },
      });

      new Notice("[Temporal Drift] Google Tasks sync complete", 2000);
    } catch (e) {
      const message = String((e as any)?.message ?? e ?? "Unknown error");
      console.error("[Temporal Drift] Google Tasks sync failed", e);
      this.updateStatus({
        state: "failed",
        inProgress: false,
        lastFinishedAt: Date.now(),
        lastError: message,
        lastStats: { ...stats },
      });
      new Notice("[Temporal Drift] Google Tasks sync failed — see console", 4000);
    } finally {
      this.syncInProgress = false;
      if (this.status.inProgress) {
        this.updateStatus({ inProgress: false });
      }
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
