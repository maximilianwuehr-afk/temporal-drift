// ============================================================================
// Google Tasks Sync Service
// ============================================================================

import { App, TFile, requestUrl, debounce } from "obsidian";
import { TemporalDriftSettings, SettingsAware, TaskMeta } from "../types";
import { TaskIndexService } from "./task-index";

interface GoogleTasksToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: "needsAction" | "completed";
  due?: string;
  updated: string;
  etag: string;
}

interface SyncMeta {
  googleTaskId?: string;
  localModified: number;
  remoteEtag?: string;
  lastSynced: number;
}

export class GoogleTasksSyncService implements SettingsAware {
  private app: App;
  private settings: TemporalDriftSettings;
  private taskIndexService: TaskIndexService;
  private token: GoogleTasksToken | null = null;
  private syncMeta = new Map<string, SyncMeta>();
  private syncInProgress = false;
  private debouncedSync: (() => void) | null = null;

  // Google OAuth config - user must provide these in settings
  private clientId = "";
  private clientSecret = "";
  private redirectUri = "obsidian://temporal-drift-oauth";

  constructor(app: App, settings: TemporalDriftSettings, taskIndexService: TaskIndexService) {
    this.app = app;
    this.settings = settings;
    this.taskIndexService = taskIndexService;
    this.setupDebouncedSync();
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
  }

  /**
   * Setup debounced sync (150ms)
   */
  private setupDebouncedSync(): void {
    this.debouncedSync = debounce(() => this.syncAll(), 150, true);
  }

  /**
   * Check if sync is configured
   */
  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.token);
  }

  /**
   * Set OAuth credentials
   */
  setCredentials(clientId: string, clientSecret: string): void {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  /**
   * Start OAuth flow - returns URL to open in browser
   */
  getAuthUrl(): string {
    const scope = "https://www.googleapis.com/auth/tasks";
    return `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(this.clientId)}&` +
      `redirect_uri=${encodeURIComponent(this.redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scope)}&` +
      `access_type=offline&` +
      `prompt=consent`;
  }

  /**
   * Exchange authorization code for tokens
   */
  async handleAuthCode(code: string): Promise<void> {
    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: this.redirectUri,
      }).toString(),
    });

    const data = response.json;
    this.token = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    };

    await this.saveToken();
  }

  /**
   * Refresh access token
   */
  private async refreshToken(): Promise<void> {
    if (!this.token?.refresh_token) {
      throw new Error("No refresh token available");
    }

    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.token.refresh_token,
        grant_type: "refresh_token",
      }).toString(),
    });

    const data = response.json;
    this.token = {
      ...this.token,
      access_token: data.access_token,
      expires_at: Date.now() + (data.expires_in * 1000),
    };

    await this.saveToken();
  }

  /**
   * Get valid access token (refresh if needed)
   */
  private async getAccessToken(): Promise<string> {
    if (!this.token) {
      throw new Error("Not authenticated");
    }

    // Refresh if expires in next 5 minutes
    if (Date.now() > this.token.expires_at - 300000) {
      await this.refreshToken();
    }

    return this.token.access_token;
  }

  /**
   * Save token to plugin data
   */
  private async saveToken(): Promise<void> {
    // Token would be saved to plugin settings
    // For security, we don't encrypt here but note this should be done in production
  }

  /**
   * Load token from plugin data
   */
  async loadToken(token: GoogleTasksToken): Promise<void> {
    this.token = token;
  }

  /**
   * Fetch all tasks from Google Tasks
   */
  private async fetchRemoteTasks(): Promise<GoogleTask[]> {
    const accessToken = await this.getAccessToken();

    // Get default task list
    const listsResponse = await requestUrl({
      url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const lists = listsResponse.json.items || [];
    if (lists.length === 0) return [];

    // Use first list
    const listId = lists[0].id;

    const tasksResponse = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    return tasksResponse.json.items || [];
  }

  /**
   * Create task in Google Tasks
   */
  private async createRemoteTask(task: TaskMeta): Promise<GoogleTask> {
    const accessToken = await this.getAccessToken();

    // Get default list
    const listsResponse = await requestUrl({
      url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const listId = listsResponse.json.items?.[0]?.id;
    if (!listId) throw new Error("No task list found");

    const response = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: this.encodeTaskTitle(task),
        notes: `Obsidian: ${task.path}`,
        status: task.status === "done" ? "completed" : "needsAction",
        due: task.due ? `${task.due}T00:00:00.000Z` : undefined,
      }),
    });

    return response.json;
  }

  /**
   * Update task in Google Tasks
   */
  private async updateRemoteTask(listId: string, taskId: string, task: TaskMeta): Promise<GoogleTask> {
    const accessToken = await this.getAccessToken();

    const response = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: this.encodeTaskTitle(task),
        status: task.status === "done" ? "completed" : "needsAction",
        due: task.due ? `${task.due}T00:00:00.000Z` : undefined,
      }),
    });

    return response.json;
  }

  /**
   * Encode task priority in title: [NOW] Task name
   */
  private encodeTaskTitle(task: TaskMeta): string {
    const prefix = `[${task.priority.toUpperCase()}]`;
    return `${prefix} ${task.title}`;
  }

  /**
   * Decode priority from title
   */
  private decodeTaskTitle(title: string): { title: string; priority: "now" | "next" | "later" } {
    const match = title.match(/^\[(NOW|NEXT|LATER)\]\s*(.*)$/i);
    if (match) {
      return {
        priority: match[1].toLowerCase() as "now" | "next" | "later",
        title: match[2],
      };
    }
    return { title, priority: "now" };
  }

  /**
   * Sync all tasks
   */
  async syncAll(): Promise<void> {
    if (!this.isConfigured() || this.syncInProgress) return;

    this.syncInProgress = true;
    try {
      const remoteTasks = await this.fetchRemoteTasks();
      const localTasks = this.taskIndexService.getByStatus("open").concat(
        this.taskIndexService.getByStatus("done")
      );

      // Reconcile each task
      for (const local of localTasks) {
        const meta = this.syncMeta.get(local.path);
        const remote = remoteTasks.find((r) => r.notes?.includes(local.path));

        if (!remote) {
          // Push new local task to remote
          const created = await this.createRemoteTask(local);
          this.syncMeta.set(local.path, {
            googleTaskId: created.id,
            localModified: Date.now(),
            remoteEtag: created.etag,
            lastSynced: Date.now(),
          });
        } else if (meta) {
          // Reconcile existing task
          await this.reconcileTask(local, remote, meta);
        }
      }
    } catch (e) {
      console.error("Temporal Drift: Sync failed", e);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Reconcile a single task between local and remote
   */
  private async reconcileTask(local: TaskMeta, remote: GoogleTask, meta: SyncMeta): Promise<void> {
    const localModified = this.getLocalModifiedTime(local);
    const remoteModified = new Date(remote.updated).getTime();

    if (localModified > meta.lastSynced) {
      // Local wins - push to remote
      // await this.updateRemoteTask(...);
      meta.lastSynced = Date.now();
    } else if (remoteModified > meta.lastSynced) {
      // Remote wins - update local
      const decoded = this.decodeTaskTitle(remote.title);
      await this.taskIndexService.updatePriority(local.path, decoded.priority);
      if (remote.status === "completed" && local.status === "open") {
        await this.taskIndexService.toggleStatus(local.path, "done");
      } else if (remote.status === "needsAction" && local.status === "done") {
        await this.taskIndexService.toggleStatus(local.path, "open");
      }
      meta.lastSynced = Date.now();
      meta.remoteEtag = remote.etag;
    }

    this.syncMeta.set(local.path, meta);
  }

  /**
   * Get local file modified time
   */
  private getLocalModifiedTime(task: TaskMeta): number {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (file instanceof TFile) {
      return file.stat.mtime;
    }
    return 0;
  }

  /**
   * Trigger sync (debounced)
   */
  triggerSync(): void {
    this.debouncedSync?.();
  }

  /**
   * Disconnect sync
   */
  disconnect(): void {
    this.token = null;
    this.syncMeta.clear();
  }
}
