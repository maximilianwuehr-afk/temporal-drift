// ============================================================================
// Google Tasks Sync Service (Obsidian Tasks/ ↔ Google Tasks)
// ============================================================================

import { App, Notice, TAbstractFile, TFile, debounce, normalizePath, requestUrl } from "obsidian";
import http from "http";
import crypto from "crypto";
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

function normalizeDueDay(due?: string): string | null {
  if (!due) return null;
  const m = due.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function encodeDueDay(due?: string): string | undefined {
  const day = normalizeDueDay(due);
  return day ? `${day}T00:00:00.000Z` : undefined;
}

function buildObsidianNotes(path: string, notes?: string): string {
  const marker = `Obsidian: ${path}`;
  if (!notes?.trim()) return marker;
  const withoutMarker = notes
    .split("\n")
    .filter((line) => !/^\s*Obsidian:\s*/i.test(line))
    .join("\n")
    .trim();
  return withoutMarker ? `${withoutMarker}\n${marker}` : marker;
}

function isoDay(date: Date): string {
  return date.toISOString().split("T")[0];
}

function base64Url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Base64Url(input: string): string {
  return base64Url(crypto.createHash("sha256").update(input).digest());
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
  // Use loopback redirect (http://127.0.0.1:<port>/oauth2callback) + PKCE.
  // Custom URI schemes are restricted by Google and are not reliable.

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
    return !!(this.settings.googleTasksEnabled && this.settings.googleTasksClientId && this.token);
  }

  private buildAuthUrl(opts: { redirectUri: string; codeChallenge: string }): string {
    const scope = "https://www.googleapis.com/auth/tasks";

    return (
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${encodeURIComponent(this.settings.googleTasksClientId)}&` +
      `redirect_uri=${encodeURIComponent(opts.redirectUri)}&` +
      `response_type=code&` +
      `scope=${encodeURIComponent(scope)}&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `code_challenge=${encodeURIComponent(opts.codeChallenge)}&` +
      `code_challenge_method=S256`
    );
  }

  /**
   * Starts a loopback OAuth flow (PKCE). Opens the consent screen in the user's browser,
   * captures the authorization code via a temporary localhost server, and stores tokens.
   */
  async beginAuthFlow(openUrl: (url: string) => void): Promise<void> {
    if (!this.settings.googleTasksClientId) {
      new Notice("[Temporal Drift] Missing Google Client ID", 4000);
      return;
    }

    const verifier = base64Url(crypto.randomBytes(32));
    const challenge = sha256Base64Url(verifier);

    const server = http.createServer();

    const codePromise = new Promise<{ code: string; redirectUri: string }>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("OAuth timeout"));
      }, 3 * 60_000);

      server.on("request", (req, res) => {
        try {
          const url = new URL(req.url ?? "/", "http://127.0.0.1");
          const code = url.searchParams.get("code");
          const err = url.searchParams.get("error");

          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");

          if (err) {
            res.end(`<h3>Authorization failed</h3><p>${err}</p><p>You may close this window.</p>`);
            clearTimeout(timeout);
            reject(new Error(String(err)));
            return;
          }

          if (!code) {
            res.end("<p>Waiting for authorization…</p>");
            return;
          }

          res.end("<h3>Connected.</h3><p>You may close this window and return to Obsidian.</p>");

          const address = server.address();
          const port = typeof address === "object" && address ? address.port : 0;
          const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

          clearTimeout(timeout);
          resolve({ code, redirectUri });
        } catch (e) {
          clearTimeout(timeout);
          reject(e);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.listen(0, "127.0.0.1", () => resolve());
      server.on("error", reject);
    });

    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;

    openUrl(this.buildAuthUrl({ redirectUri, codeChallenge: challenge }));

    try {
      const { code: authCode, redirectUri: finalRedirect } = await codePromise;
      await this.exchangeAuthCode({ code: authCode, redirectUri: finalRedirect, verifier });
    } finally {
      server.close();
    }
  }

  private async exchangeAuthCode(opts: { code: string; redirectUri: string; verifier: string }): Promise<void> {
    const body = new URLSearchParams({
      client_id: this.settings.googleTasksClientId,
      code: opts.code,
      code_verifier: opts.verifier,
      grant_type: "authorization_code",
      redirect_uri: opts.redirectUri,
    });

    // Client secret is optional (desktop apps shouldn't rely on it, but allow it for compatibility).
    if (this.settings.googleTasksClientSecret?.trim()) {
      body.set("client_secret", this.settings.googleTasksClientSecret.trim());
    }

    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
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

    const body = new URLSearchParams({
      client_id: this.settings.googleTasksClientId,
      refresh_token: this.token.refresh_token,
      grant_type: "refresh_token",
    });

    if (this.settings.googleTasksClientSecret?.trim()) {
      body.set("client_secret", this.settings.googleTasksClientSecret.trim());
    }

    const response = await requestUrl({
      url: "https://oauth2.googleapis.com/token",
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
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
        notes: buildObsidianNotes(task.path),
        status: task.status === "done" ? "completed" : "needsAction",
        due: encodeDueDay(task.due),
      }),
    });

    return response.json as any;
  }

  private async patchRemoteTask(
    listId: string,
    taskId: string,
    patch: Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">>,
    opts?: { ifMatchEtag?: string }
  ): Promise<GoogleTask> {
    const accessToken = await this.getAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    };

    if (opts?.ifMatchEtag?.trim()) {
      headers["If-Match"] = opts.ifMatchEtag.trim();
    }

    const response = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
      method: "PATCH",
      headers,
      body: JSON.stringify(patch),
    });

    return response.json as any;
  }

  private async fetchRemoteTaskById(listId: string, taskId: string): Promise<GoogleTask> {
    const accessToken = await this.getAccessToken();

    const response = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
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

    const doneFromStatus = typeof current.status === "string" ? String(current.status).toLowerCase() === "done" : undefined;
    const doneNeedsWrite = typeof current.done !== "boolean" && typeof doneFromStatus === "boolean";

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

      // also keep canonical booleans consistent
      if (typeof (fm as any).done !== "boolean" && typeof (fm as any).status === "string") {
        (fm as any).done = String((fm as any).status).toLowerCase() === "done";
      }
    });
  }

  private remotePayloadFromLocal(local: TaskMeta, remote?: GoogleTask): Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">> {
    return {
      title: encodeTaskTitle(local),
      status: local.status === "done" ? "completed" : "needsAction",
      due: encodeDueDay(local.due),
      notes: buildObsidianNotes(local.path, remote?.notes),
    };
  }

  private remoteMatchesLocal(local: TaskMeta, remote: GoogleTask): boolean {
    const expected = this.remotePayloadFromLocal(local, remote);
    const remoteDue = normalizeDueDay(remote.due);
    const expectedDue = normalizeDueDay(expected.due);
    return (
      remote.title === expected.title &&
      remote.status === expected.status &&
      remoteDue === expectedDue &&
      parseObsidianPathFromNotes(remote.notes) === local.path
    );
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
    const fm = this.getFrontmatter(file);
    const nextStatus = canonicalStatus(done);
    const nextDone = done;
    const nextPriority = decoded.priority;

    const needsFrontmatterUpdate =
      String(fm.status ?? "") !== nextStatus ||
      Boolean(fm.done ?? false) !== nextDone ||
      String(fm.priority ?? "") !== nextPriority;

    if (needsFrontmatterUpdate) {
      await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
        frontmatter.status = nextStatus;
        (frontmatter as any).done = nextDone;
        frontmatter.priority = nextPriority;
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

    // Collision-safe local file creation: if title path exists, suffix with remote id fragment.
    let path = normalizePath(`${this.settings.tasksFolder}/${safe}.md`);
    const baseId = sanitizeFileName(remote.id).slice(0, 8) || String(Date.now());
    let bump = 0;
    while (this.app.vault.getAbstractFileByPath(path) instanceof TFile) {
      bump += 1;
      const suffix = bump === 1 ? baseId : `${baseId}-${bump}`;
      path = normalizePath(`${this.settings.tasksFolder}/${safe} (${suffix}).md`);
    }

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

    const stats = {
      remoteCreates: 0,
      remotePatches: 0,
      remoteNoops: 0,
      localCreates: 0,
      localPulls: 0,
      localNoops: 0,
      conflicts: 0,
    };

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

        if (localModified > lastSynced && remoteModified > lastSynced) {
          stats.conflicts += 1;
          this.logSyncDecision("conflict_detected", {
            path: file.path,
            taskId: remote.id,
            localModified,
            remoteModified,
            lastSynced,
            strategy: "local_wins",
          });
        }

        if (localModified > lastSynced) {
          if (statesAlreadyMatch) {
            await this.writeSyncMeta(file, {
              id: remote.id,
              etag: remote.etag,
              lastSynced: this.computeSyncStamp(file, local),
            });
            stats.remoteNoops += 1;
            this.logSyncDecision("remote_noop", {
              path: file.path,
              taskId: remote.id,
              reason: "already_equal",
            });
          } else {
            const before = local.googleEtag ?? remote.etag;
            const next = await this.pushLocalToRemote(file, local, remote, listId);
            if (next.etag !== before) stats.remotePatches += 1;
          }
          continue;
        }

        if (remoteModified > lastSynced) {
          if (statesAlreadyMatch) {
            await this.writeSyncMeta(file, {
              id: remote.id,
              etag: remote.etag,
              lastSynced: this.computeSyncStamp(file, local),
            });
            stats.localNoops += 1;
            this.logSyncDecision("local_noop", {
              path: file.path,
              taskId: remote.id,
              reason: "already_equal",
            });
          } else {
            await this.applyRemoteToLocal(file, remote, listId);
            stats.localPulls += 1;
            this.logSyncDecision("local_apply", {
              path: file.path,
              taskId: remote.id,
            });
          }
          continue;
        }

        // No timestamp-based change; still normalize sync metadata if stale.
        if (statesAlreadyMatch && (local.googleEtag !== remote.etag || (local.googleLastSynced ?? 0) < file.stat.mtime)) {
          await this.writeSyncMeta(file, {
            id: remote.id,
            etag: remote.etag,
            lastSynced: this.computeSyncStamp(file, local),
          });
          stats.localNoops += 1;
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
