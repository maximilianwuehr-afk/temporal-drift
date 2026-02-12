// ============================================================================
// Google Tasks - Encoding/Parsing Utilities
// ============================================================================

import { GoogleTasksSyncStats, TaskMeta } from "../../../types";
import { GoogleTask, GoogleTasksPreviewAction, RemoteTaskStatus } from "./types";

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "-").trim();
}

export function parseObsidianPathFromNotes(notes?: string): string | null {
  if (!notes) return null;
  const m = notes.match(/Obsidian:\s*([^\n]+)/i);
  return m?.[1]?.trim() || null;
}

export function encodeTaskTitle(task: Pick<TaskMeta, "title" | "priority">): string {
  return `[${task.priority.toUpperCase()}] ${task.title}`;
}

export function decodeTaskTitle(title: string): { title: string; priority: "now" | "next" | "later" } {
  const match = title.match(/^\[(NOW|NEXT|LATER)\]\s*(.*)$/i);
  if (match) {
    return {
      priority: match[1].toLowerCase() as "now" | "next" | "later",
      title: match[2],
    };
  }
  return { title, priority: "now" };
}

export function canonicalStatus(done: boolean): "open" | "done" {
  return done ? "done" : "open";
}

export function parseRemoteDone(status: RemoteTaskStatus): boolean {
  return status === "completed";
}

export function normalizeDueDay(due?: string): string | null {
  if (!due) return null;
  const m = due.match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

export function encodeDueDay(due?: string): string | undefined {
  const day = normalizeDueDay(due);
  return day ? `${day}T00:00:00.000Z` : undefined;
}

export function buildObsidianNotes(path: string, notes?: string): string {
  const marker = `Obsidian: ${path}`;
  if (!notes?.trim()) return marker;

  const withoutMarker = notes
    .split("\n")
    .filter((line) => !/^\s*Obsidian:\s*/i.test(line))
    .join("\n")
    .trim();

  return withoutMarker ? `${withoutMarker}\n${marker}` : marker;
}

export function isoDay(date: Date): string {
  return date.toISOString().split("T")[0];
}

export function emptySyncStats(): GoogleTasksSyncStats {
  return {
    remoteCreates: 0,
    remotePatches: 0,
    remoteNoops: 0,
    localCreates: 0,
    localPulls: 0,
    localNoops: 0,
    conflicts: 0,
  };
}

export function emptyPreviewCounts(): Record<GoogleTasksPreviewAction, number> {
  return {
    create_remote: 0,
    update_remote: 0,
    update_local: 0,
    create_local: 0,
    noop: 0,
    conflict: 0,
  };
}

export function toRemotePatch(
  local: TaskMeta,
  remote?: Pick<GoogleTask, "notes">,
): Partial<Pick<GoogleTask, "title" | "status" | "due" | "notes">> {
  return {
    title: encodeTaskTitle(local),
    status: local.status === "done" ? "completed" : "needsAction",
    due: encodeDueDay(local.due),
    notes: buildObsidianNotes(local.path, remote?.notes),
  };
}
