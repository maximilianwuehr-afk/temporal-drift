// ============================================================================
// Calendar Service - Google Calendar Integration
// ============================================================================

import { App, TFile } from "obsidian";
import { TemporalDriftSettings, SettingsAware, Participant, CalendarEvent } from "../types";

// Re-export for compatibility
export type { Participant, CalendarEvent };

export class CalendarService implements SettingsAware {
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

  /**
   * Check if Google Calendar plugin is available
   */
  isAvailable(): boolean {
    this.calendarPlugin = (this.app as any).plugins?.getPlugin("google-calendar");
    return !!this.calendarPlugin;
  }

  /**
   * Get events for a specific date
   */
  async getEventsForDate(date: Date): Promise<CalendarEvent[]> {
    if (!this.isAvailable()) {
      return [];
    }

    try {
      // Try to access the calendar plugin's API
      const api = this.calendarPlugin?.api;
      if (!api?.getEvents) {
        return [];
      }

      const events = await api.getEvents(date);
      return events.map((event: any) => this.mapEvent(event));
    } catch (e) {
      console.warn("Temporal Drift: Failed to fetch calendar events", e);
      return [];
    }
  }

  /**
   * Map external event format to our interface
   */
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

  /**
   * Extract participants with name and email from event
   */
  private extractParticipants(event: any): Participant[] {
    const attendees = event.attendees || [];
    return attendees
      .filter((a: any) => !a.resource && !a.self)
      .map((a: any) => ({
        name: a.displayName || this.emailToDisplayName(a.email || ""),
        email: a.email || "",
      }))
      .filter((p: Participant) => p.email.length > 0);
  }

  /**
   * Resolve participant email to People note
   */
  async resolveParticipant(email: string): Promise<TFile | null> {
    const peopleFolder = this.settings.peopleFolder;
    const files = this.app.vault.getMarkdownFiles();

    for (const file of files) {
      if (!file.path.startsWith(peopleFolder)) continue;

      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter;

      if (frontmatter?.email === email || frontmatter?.emails?.includes(email)) {
        return file;
      }
    }

    return null;
  }

  /**
   * Create a People note for an email address
   */
  async createPersonNote(email: string): Promise<TFile> {
    const displayName = this.emailToDisplayName(email);
    const path = `${this.settings.peopleFolder}/${displayName}.md`;

    const content = `---
email: ${email}
---

# ${displayName}
`;

    const file = await this.app.vault.create(path, content);
    return file;
  }

  /**
   * Convert email to display name
   */
  private emailToDisplayName(email: string): string {
    const localPart = email.split("@")[0];
    return localPart
      .split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }

  /**
   * Get or create a People note for an email
   */
  async getOrCreatePerson(email: string): Promise<TFile> {
    const existing = await this.resolveParticipant(email);
    if (existing) return existing;
    return await this.createPersonNote(email);
  }
}
