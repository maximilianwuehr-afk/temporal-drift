import { App, TFile, normalizePath } from "obsidian";
import { SettingsAware, TemporalDriftSettings } from "../types";
import { CalendarEvent, CalendarService } from "./calendar";
import {
  CalendarRemoteSnapshot,
  CalendarSyncState,
  CalendarSyncStateService,
} from "./calendar-sync-state";
import {
  extractEventIdFromHead,
  parseTimelineLine,
  replaceTimeToken,
} from "../parsing/timeline";
import { formatTime } from "../utils/time";

export interface CalendarEventSyncStats {
  patchedTimes: number;
  insertedEvents: number;
  suppressedEvents: number;
  suppressedByDelete: number;
  unchanged: number;
  conflicts: number;
}

export interface CalendarEventSyncPreview extends CalendarEventSyncStats {
  date: string;
  totalRemote: number;
  notes: string[];
}

interface LocalEventIndex {
  firstLineByEventId: Map<string, { index: number; time: string }>;
  duplicateEventIds: Set<string>;
}

const EMPTY_STATS: CalendarEventSyncStats = {
  patchedTimes: 0,
  insertedEvents: 0,
  suppressedEvents: 0,
  suppressedByDelete: 0,
  unchanged: 0,
  conflicts: 0,
};

export class CalendarEventSyncService implements SettingsAware {
  private app: App;
  private settings: TemporalDriftSettings;
  private calendarService: CalendarService;
  private calendarSyncState: CalendarSyncStateService;
  private lastPreview: CalendarEventSyncPreview | null = null;

  constructor(app: App, settings: TemporalDriftSettings, calendarService: CalendarService) {
    this.app = app;
    this.settings = settings;
    this.calendarService = calendarService;
    this.calendarSyncState = new CalendarSyncStateService(app);
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.calendarService.updateSettings(settings);
  }

  getLastPreview(): CalendarEventSyncPreview | null {
    return this.lastPreview;
  }

  async previewDate(
    date: string,
    options: { events?: CalendarEvent[] } = {}
  ): Promise<CalendarEventSyncPreview> {
    const { file, lines, events, state } = await this.loadSyncContext(date, options.events);

    const notes: string[] = [];
    const stats: CalendarEventSyncStats = { ...EMPTY_STATS };

    if (!file) {
      const preview: CalendarEventSyncPreview = {
        date,
        totalRemote: events.length,
        notes: ["Daily note missing; no markdown patching possible."],
        ...stats,
      };
      this.lastPreview = preview;
      return preview;
    }

    const local = this.buildLocalEventIndex(lines);
    if (local.duplicateEventIds.size > 0) {
      stats.conflicts += local.duplicateEventIds.size;
      notes.push(
        `Duplicate local event ids: ${Array.from(local.duplicateEventIds)
          .sort()
          .join(", ")}`
      );
    }

    for (const event of events) {
      const key = this.calendarSyncState.makeKey("primary", event.id);
      const existing = local.firstLineByEventId.get(event.id);
      const nextTime = formatTime(event.start);

      if (state.suppressedEventIds[key]) {
        stats.suppressedEvents += 1;
        continue;
      }

      if (existing) {
        if (existing.time !== nextTime) stats.patchedTimes += 1;
        else stats.unchanged += 1;
        continue;
      }

      const seenBefore = !!state.lastRemoteSnapshot[key];
      if (seenBefore) {
        stats.suppressedByDelete += 1;
        continue;
      }

      stats.insertedEvents += 1;
    }

    const preview: CalendarEventSyncPreview = {
      date,
      totalRemote: events.length,
      notes,
      ...stats,
    };

    this.lastPreview = preview;
    return preview;
  }

  formatPreviewSummary(preview: CalendarEventSyncPreview): string {
    const lines = [
      `[Temporal Drift] Calendar preview for ${preview.date}`,
      `Remote events: ${preview.totalRemote}`,
      `Time patches: ${preview.patchedTimes}`,
      `Insertions: ${preview.insertedEvents}`,
      `Suppressed (manual): ${preview.suppressedEvents}`,
      `Suppressed (local delete wins): ${preview.suppressedByDelete}`,
      `Unchanged: ${preview.unchanged}`,
      `Conflicts: ${preview.conflicts}`,
    ];

    if (preview.notes.length > 0) {
      lines.push(`Notes: ${preview.notes.join(" | ")}`);
    }

    return lines.join("\n");
  }

  async syncDate(
    date: string,
    options: { events?: CalendarEvent[] } = {}
  ): Promise<CalendarEventSyncStats> {
    const { file, lines, events, state, path } = await this.loadSyncContext(date, options.events);
    const stats: CalendarEventSyncStats = { ...EMPTY_STATS };

    if (!file) return stats;

    const local = this.buildLocalEventIndex(lines);
    if (local.duplicateEventIds.size > 0) {
      stats.conflicts += local.duplicateEventIds.size;
      console.warn(
        "[Temporal Drift] Duplicate local event ids detected",
        Array.from(local.duplicateEventIds)
      );
    }

    let changed = false;
    let stateChanged = false;

    for (const event of events) {
      const key = this.calendarSyncState.makeKey("primary", event.id);
      const existing = local.firstLineByEventId.get(event.id);

      // Manual restore: if user re-added the line, clear suppression.
      if (existing && state.suppressedEventIds[key]) {
        delete state.suppressedEventIds[key];
        stateChanged = true;
      }

      if (state.suppressedEventIds[key]) {
        state.lastRemoteSnapshot[key] = this.toSnapshot(event, date);
        stats.suppressedEvents += 1;
        stateChanged = true;
        continue;
      }

      const nextTime = formatTime(event.start);

      if (existing) {
        if (existing.time !== nextTime) {
          const nextLine = replaceTimeToken(lines[existing.index], nextTime);
          if (nextLine !== lines[existing.index]) {
            lines[existing.index] = nextLine;
            changed = true;
            stats.patchedTimes += 1;
          }
        } else {
          stats.unchanged += 1;
        }
      } else {
        const seenBefore = !!state.lastRemoteSnapshot[key];
        if (seenBefore) {
          // Local delete wins: don't reinsert automatically after prior presence.
          state.suppressedEventIds[key] = {
            deletedAt: Date.now(),
            sourcePath: path,
            reason: "local-delete",
          };
          stateChanged = true;
          stats.suppressedByDelete += 1;
          continue;
        }

        const insertIndex = this.findInsertIndex(lines, nextTime);
        lines.splice(insertIndex, 0, this.buildEventLine(event));
        changed = true;
        stats.insertedEvents += 1;
      }

      state.lastRemoteSnapshot[key] = this.toSnapshot(event, date);
      stateChanged = true;
    }

    if (changed) {
      await this.app.vault.modify(file, lines.join("\n"));
    }

    if (stateChanged) {
      await this.calendarSyncState.save(state);
    }

    console.debug("[Temporal Drift] Calendar sync stats", { date, ...stats });

    return stats;
  }

  async restoreSuppressedForDate(date: string): Promise<number> {
    const state = await this.calendarSyncState.load();
    let restored = 0;

    for (const key of Object.keys(state.suppressedEventIds)) {
      const snap = state.lastRemoteSnapshot[key];
      if (!snap) continue;
      if (snap.sourceDate !== date) continue;
      delete state.suppressedEventIds[key];
      restored += 1;
    }

    if (restored > 0) {
      await this.calendarSyncState.save(state);
    }

    return restored;
  }

  private async loadSyncContext(date: string, providedEvents?: CalendarEvent[]): Promise<{
    file: TFile | null;
    path: string;
    lines: string[];
    events: CalendarEvent[];
    state: CalendarSyncState;
  }> {
    const path = normalizePath(`${this.settings.dailyNotesFolder}/${date}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);

    const events =
      providedEvents ?? (await this.calendarService.getEventsForDate(new Date(`${date}T00:00:00`)));

    const state = await this.calendarSyncState.load();

    if (!(file instanceof TFile)) {
      return { file: null, path, lines: [], events, state };
    }

    let content = "";
    try {
      content = await this.app.vault.read(file);
    } catch (e) {
      console.warn("Temporal Drift: Failed reading note for calendar sync", path, e);
      return { file, path, lines: [], events, state };
    }

    return { file, path, lines: content.split("\n"), events, state };
  }

  private buildLocalEventIndex(lines: string[]): LocalEventIndex {
    const firstLineByEventId = new Map<string, { index: number; time: string }>();
    const duplicateEventIds = new Set<string>();

    for (let i = 0; i < lines.length; i++) {
      const parsed = parseTimelineLine(lines[i]);
      if (!parsed) continue;

      const id = extractEventIdFromHead(parsed.head);
      if (!id) continue;

      const timeMatch = parsed.timeText.match(/\d{2}:\d{2}/);
      const time = timeMatch ? timeMatch[0] : "";

      if (firstLineByEventId.has(id)) {
        duplicateEventIds.add(id);
        continue;
      }

      firstLineByEventId.set(id, { index: i, time });
    }

    return { firstLineByEventId, duplicateEventIds };
  }

  private findInsertIndex(lines: string[], hhmm: string): number {
    const target = this.toMinutes(hhmm);
    if (!Number.isFinite(target)) return lines.length;

    let lastTimelineLine = -1;

    for (let i = 0; i < lines.length; i++) {
      const parsed = parseTimelineLine(lines[i]);
      if (!parsed) continue;

      lastTimelineLine = i;
      const current = this.toMinutes(parsed.timeText);
      if (Number.isFinite(current) && current > target) return i;
    }

    return lastTimelineLine >= 0 ? lastTimelineLine + 1 : lines.length;
  }

  private toMinutes(timeText: string): number {
    const m = timeText.match(/(\d{2}):(\d{2})/);
    if (!m) return Number.NaN;
    return Number(m[1]) * 60 + Number(m[2]);
  }

  private buildEventLine(event: CalendarEvent): string {
    const title = event.title.replace(/[\[\]]/g, "").trim() || "Untitled";
    const participants = event.participants
      .map((p) => p.name.replace(/[\[\]]/g, "").trim())
      .filter((name) => name.length > 0)
      .map((name) => `[[${name}]]`)
      .join(", ");

    const withPart = participants ? ` with ${participants}` : "";
    return `${formatTime(event.start)} [[${title} ~${event.id}]]${withPart}`;
  }

  private toSnapshot(event: CalendarEvent, date: string): CalendarRemoteSnapshot {
    return {
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      sourceDate: date,
    };
  }
}
