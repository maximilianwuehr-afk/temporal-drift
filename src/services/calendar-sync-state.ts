import { App } from "obsidian";

export interface SuppressedCalendarEvent {
  deletedAt: number;
  sourcePath?: string;
  reason?: "local-delete" | "manual";
}

export interface CalendarRemoteSnapshot {
  start: string;
  end: string;
  updated?: string;
  etag?: string;
  sourceDate?: string;
}

export interface CalendarSyncState {
  suppressedEventIds: Record<string, SuppressedCalendarEvent>;
  lastRemoteSnapshot: Record<string, CalendarRemoteSnapshot>;
}

const DEFAULT_STATE: CalendarSyncState = {
  suppressedEventIds: {},
  lastRemoteSnapshot: {},
};

interface DataPluginLike {
  loadData(): Promise<unknown>;
  saveData(data: unknown): Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeSuppressed(
  value: unknown
): Record<string, SuppressedCalendarEvent> {
  if (!isObject(value)) return {};

  const out: Record<string, SuppressedCalendarEvent> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isObject(raw)) continue;

    const deletedAt =
      typeof raw.deletedAt === "number" && Number.isFinite(raw.deletedAt)
        ? raw.deletedAt
        : Date.now();

    const sourcePath =
      typeof raw.sourcePath === "string" ? raw.sourcePath : undefined;

    const reason =
      raw.reason === "local-delete" || raw.reason === "manual"
        ? raw.reason
        : undefined;

    out[key] = { deletedAt, sourcePath, reason };
  }

  return out;
}

function normalizeSnapshots(
  value: unknown
): Record<string, CalendarRemoteSnapshot> {
  if (!isObject(value)) return {};

  const out: Record<string, CalendarRemoteSnapshot> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isObject(raw)) continue;

    const start = typeof raw.start === "string" ? raw.start : "";
    const end = typeof raw.end === "string" ? raw.end : "";
    if (!start || !end) continue;

    out[key] = {
      start,
      end,
      updated: typeof raw.updated === "string" ? raw.updated : undefined,
      etag: typeof raw.etag === "string" ? raw.etag : undefined,
      sourceDate: typeof raw.sourceDate === "string" ? raw.sourceDate : undefined,
    };
  }

  return out;
}

export class CalendarSyncStateService {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  makeKey(calendarId: string, eventId: string): string {
    return `${calendarId}:${eventId}`;
  }

  async load(): Promise<CalendarSyncState> {
    const data = await this.readPluginData();
    const raw = isObject(data.calendarSync) ? data.calendarSync : {};

    return {
      suppressedEventIds: normalizeSuppressed(raw.suppressedEventIds),
      lastRemoteSnapshot: normalizeSnapshots(raw.lastRemoteSnapshot),
    };
  }

  async save(state: CalendarSyncState): Promise<void> {
    const plugin = this.getPlugin();
    if (!plugin) return;

    const data = await this.readPluginData();
    data.calendarSync = {
      suppressedEventIds: state.suppressedEventIds,
      lastRemoteSnapshot: state.lastRemoteSnapshot,
    };

    await plugin.saveData(data);
  }

  private getPlugin(): DataPluginLike | null {
    const plugin = (this.app as unknown as { plugins?: { getPlugin?: (id: string) => unknown } })
      .plugins?.getPlugin?.("temporal-drift");

    if (!plugin || !isObject(plugin)) return null;
    if (typeof plugin.loadData !== "function") return null;
    if (typeof plugin.saveData !== "function") return null;

    return plugin as unknown as DataPluginLike;
  }

  private async readPluginData(): Promise<Record<string, unknown>> {
    const plugin = this.getPlugin();
    if (!plugin) return { ...DEFAULT_STATE };

    const raw = await plugin.loadData();
    if (!isObject(raw)) return {};
    return { ...raw };
  }
}
