// ============================================================================
// Google Tasks - Shared Types
// ============================================================================

export type RemoteTaskStatus = "needsAction" | "completed";

export interface GoogleTask {
  id: string;
  title: string;
  notes?: string;
  status: RemoteTaskStatus;
  due?: string;
  updated: string;
  etag: string;
}

export interface GoogleTaskList {
  id: string;
  title: string;
}

export type GoogleTasksPreviewAction =
  | "create_remote"
  | "update_remote"
  | "update_local"
  | "create_local"
  | "noop"
  | "conflict";

export interface GoogleTasksPreviewItem {
  action: GoogleTasksPreviewAction;
  path: string;
  taskId?: string;
  reason?: string;
}

export interface GoogleTasksPreviewResult {
  listId: string;
  generatedAt: number;
  counts: Record<GoogleTasksPreviewAction, number>;
  items: GoogleTasksPreviewItem[];
}
