// ============================================================================
// Google Tasks - Remote API Client
// ============================================================================

import { requestUrl } from "obsidian";

import { TaskMeta } from "../../../types";
import { GoogleAuthSession } from "../auth/google-auth-session";
import { buildObsidianNotes, encodeDueDay, encodeTaskTitle } from "./task-codec";
import { GoogleTask, GoogleTaskList } from "./types";

interface GoogleTasksRemoteClientOptions {
  auth: GoogleAuthSession;
  getListId: () => string;
  onTokenRefresh?: () => void;
}

export class GoogleTasksRemoteClient {
  private auth: GoogleAuthSession;
  private getListIdSetting: () => string;
  private onTokenRefresh?: () => void;

  constructor(options: GoogleTasksRemoteClientOptions) {
    this.auth = options.auth;
    this.getListIdSetting = options.getListId;
    this.onTokenRefresh = options.onTokenRefresh;
  }

  async listTaskLists(): Promise<GoogleTaskList[]> {
    const accessToken = await this.getAccessToken();

    const listsResponse = await requestUrl({
      url: "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const items = (listsResponse.json as any).items ?? [];
    return items.map((l: any) => ({ id: String(l.id), title: String(l.title ?? "") }));
  }

  async resolveListId(): Promise<string> {
    const configured = this.getListIdSetting().trim();
    if (configured) return configured;

    const lists = await this.listTaskLists();
    const first = lists[0]?.id;
    if (!first) throw new Error("No Google Task lists found");

    return first;
  }

  async listTasks(listId: string): Promise<GoogleTask[]> {
    const accessToken = await this.getAccessToken();

    const tasksResponse = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks?showCompleted=true&showHidden=true&maxResults=1000`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return ((tasksResponse.json as any).items ?? []) as GoogleTask[];
  }

  async createTask(listId: string, task: TaskMeta): Promise<GoogleTask> {
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

  async patchTask(
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

  async getTaskById(listId: string, taskId: string): Promise<GoogleTask> {
    const accessToken = await this.getAccessToken();

    const response = await requestUrl({
      url: `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks/${taskId}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return response.json as any;
  }

  private async getAccessToken(): Promise<string> {
    const accessToken = await this.auth.getAccessToken();
    this.onTokenRefresh?.();
    return accessToken;
  }
}
