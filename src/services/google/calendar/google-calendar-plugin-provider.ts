// ============================================================================
// Google Calendar - External Obsidian Plugin Provider
// ============================================================================

import { App } from "obsidian";

import { CalendarEvent, Participant, TemporalDriftSettings } from "../../../types";
import { CalendarProvider } from "./provider-types";

export class GoogleCalendarPluginProvider implements CalendarProvider {
  readonly id = "plugin" as const;

  private app: App;
  private settings: TemporalDriftSettings;
  private calendarPlugin: any = null;

  constructor(app: App, settings: TemporalDriftSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
  }

  isAvailable(): boolean {
    this.calendarPlugin = (this.app as any).plugins?.getPlugin("google-calendar");
    return !!this.calendarPlugin;
  }

  async getEventsForDate(date: Date): Promise<CalendarEvent[]> {
    if (!this.isAvailable()) return [];

    try {
      const api = this.calendarPlugin?.api;
      if (!api?.getEvents) return [];

      const events = await api.getEvents(date);
      return events.map((event: any) => this.mapEvent(event));
    } catch (error) {
      console.warn("Temporal Drift: Failed to fetch calendar events from plugin", error);
      return [];
    }
  }

  getSyncIntervalMs(): number {
    return 5 * 60_000;
  }

  private mapEvent(event: any): CalendarEvent {
    return {
      id: event.id || "",
      title: event.title || event.summary || "",
      start: new Date(event.start?.dateTime || event.start?.date || event.start),
      end: new Date(event.end?.dateTime || event.end?.date || event.end),
      participants: this.extractParticipants(event),
      location: event.location,
      description: event.description,
    };
  }

  private extractParticipants(event: any): Participant[] {
    const attendees = event.attendees || [];
    return attendees
      .filter((a: any) => !a.resource && !a.self)
      .map((a: any) => ({
        name: a.displayName || this.emailToDisplayName(a.email || ""),
        email: a.email || "",
      }))
      .filter((participant: Participant) => participant.email.length > 0);
  }

  private emailToDisplayName(email: string): string {
    const localPart = email.split("@")[0];
    return localPart
      .split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
}
