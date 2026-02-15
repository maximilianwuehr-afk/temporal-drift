// ============================================================================
// Google Tasks - Local Reconciliation Helpers
// ============================================================================

import { App, TFile, normalizePath } from "obsidian";

import { TaskMeta } from "../../../types";
import {
  buildObsidianNotes,
  canonicalStatus,
  decodeTaskTitle,
  isoDay,
  normalizeDueDay,
  parseObsidianPathFromNotes,
  parseRemoteDone,
  sanitizeFileName,
  toRemotePatch,
} from "./task-codec";
import { GoogleTask } from "./types";

interface SyncMeta {
  id: string;
  etag: string;
  lastSynced: number;
}

interface LocalTaskReconciliationOptions {
  app: App;
  getTasksFolder: () => string;
  getTaskFieldKeys: () => { statusKey: string; doneKey: string; priorityKey: string };
  getFrontmatter: (file: TFile) => Record<string, any>;
  getLocalTaskMeta: (file: TFile) => TaskMeta;
  computeSyncStamp: (file: TFile, local?: TaskMeta) => number;
  writeSyncMeta: (file: TFile, meta: SyncMeta) => Promise<void>;
  patchRemoteTask: (
    listId: string,
    taskId: string,
    patch: Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">>,
    opts?: { ifMatchEtag?: string }
  ) => Promise<GoogleTask>;
  fetchRemoteTaskById: (listId: string, taskId: string) => Promise<GoogleTask>;
  logSyncDecision: (action: string, payload: Record<string, unknown>) => void;
  getHttpStatus: (error: unknown) => number | null;
}

export class LocalTaskReconciliation {
  private app: App;
  private getTasksFolder: () => string;
  private getTaskFieldKeys: () => { statusKey: string; doneKey: string; priorityKey: string };
  private getFrontmatter: (file: TFile) => Record<string, any>;
  private getLocalTaskMeta: (file: TFile) => TaskMeta;
  private computeSyncStamp: (file: TFile, local?: TaskMeta) => number;
  private writeSyncMeta: (file: TFile, meta: SyncMeta) => Promise<void>;
  private patchRemoteTask: (
    listId: string,
    taskId: string,
    patch: Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">>,
    opts?: { ifMatchEtag?: string }
  ) => Promise<GoogleTask>;
  private fetchRemoteTaskById: (listId: string, taskId: string) => Promise<GoogleTask>;
  private logSyncDecision: (action: string, payload: Record<string, unknown>) => void;
  private getHttpStatus: (error: unknown) => number | null;

  constructor(options: LocalTaskReconciliationOptions) {
    this.app = options.app;
    this.getTasksFolder = options.getTasksFolder;
    this.getTaskFieldKeys = options.getTaskFieldKeys;
    this.getFrontmatter = options.getFrontmatter;
    this.getLocalTaskMeta = options.getLocalTaskMeta;
    this.computeSyncStamp = options.computeSyncStamp;
    this.writeSyncMeta = options.writeSyncMeta;
    this.patchRemoteTask = options.patchRemoteTask;
    this.fetchRemoteTaskById = options.fetchRemoteTaskById;
    this.logSyncDecision = options.logSyncDecision;
    this.getHttpStatus = options.getHttpStatus;
  }

  remotePayloadFromLocal(local: TaskMeta, remote?: GoogleTask): Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">> {
    return toRemotePatch(local, remote);
  }

  remoteMatchesLocal(local: TaskMeta, remote: GoogleTask): boolean {
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

  async applyRemoteToLocal(file: TFile, remote: GoogleTask, listId: string): Promise<void> {
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

    const { statusKey, doneKey, priorityKey } = this.getTaskFieldKeys();

    // Update frontmatter only when it actually changes.
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

  async pushLocalToRemote(file: TFile, local: TaskMeta, remote: GoogleTask, listId: string): Promise<GoogleTask> {
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

  suggestLocalPathForRemote(remote: GoogleTask, occupied?: Set<string>): string {
    const decoded = decodeTaskTitle(remote.title);
    const safe = sanitizeFileName(decoded.title) || `Google Task ${isoDay(new Date())}`;

    let path = normalizePath(`${this.getTasksFolder()}/${safe}.md`);
    const baseId = sanitizeFileName(remote.id).slice(0, 8) || String(Date.now());
    let bump = 0;

    const isTaken = (candidate: string): boolean => {
      if (occupied?.has(candidate)) return true;
      return this.app.vault.getAbstractFileByPath(candidate) instanceof TFile;
    };

    while (isTaken(path)) {
      bump += 1;
      const suffix = bump === 1 ? baseId : `${baseId}-${bump}`;
      path = normalizePath(`${this.getTasksFolder()}/${safe} (${suffix}).md`);
    }

    return path;
  }

  async ensureLocalFromRemote(remote: GoogleTask): Promise<TFile | null> {
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
}
