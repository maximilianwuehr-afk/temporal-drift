// ============================================================================
// Calendar Service - Provider Selection + Participant Resolution
// ============================================================================

import { App, TFile } from "obsidian";

import { TemporalDriftSettings, SettingsAware, Participant, CalendarEvent, GoogleOAuthToken } from "../types";
import { GoogleCalendarApiProvider } from "./google/calendar/google-calendar-api-provider";
import { GoogleCalendarPluginProvider } from "./google/calendar/google-calendar-plugin-provider";
import { CalendarProvider, CalendarProviderId } from "./google/calendar/provider-types";

// Re-export for compatibility
export type { Participant, CalendarEvent };

interface CalendarServiceOptions {
  onGoogleCalendarTokenUpdate?: (token: GoogleOAuthToken | null) => Promise<void>;
}

export class CalendarService implements SettingsAware {
  private app: App;
  private settings: TemporalDriftSettings;

  private pluginProvider: GoogleCalendarPluginProvider;
  private nativeProvider: GoogleCalendarApiProvider;

  constructor(app: App, settings: TemporalDriftSettings, options: CalendarServiceOptions = {}) {
    this.app = app;
    this.settings = settings;

    this.pluginProvider = new GoogleCalendarPluginProvider(app, settings);
    this.nativeProvider = new GoogleCalendarApiProvider(settings, {
      onTokenUpdate: options.onGoogleCalendarTokenUpdate ?? (async () => {}),
    });
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.pluginProvider.updateSettings(settings);
    this.nativeProvider.updateSettings(settings);
  }

  isAvailable(): boolean {
    return !!this.resolveActiveProvider();
  }

  getActiveProviderId(): CalendarProviderId | null {
    return this.resolveActiveProvider()?.id ?? null;
  }

  getAutoSyncIntervalMs(): number | null {
    const provider = this.resolveActiveProvider();
    if (!provider) return null;

    return provider.getSyncIntervalMs?.() ?? 5 * 60_000;
  }

  getSyncSourceId(): string {
    const provider = this.resolveActiveProvider();
    if (!provider) return "none";

    if (provider.id === "native") {
      const calendarId = this.settings.googleCalendarId?.trim() || "primary";
      return `google:${calendarId}`;
    }

    return "plugin:google-calendar";
  }

  /**
   * Get events for a specific date from the active provider.
   */
  async getEventsForDate(date: Date): Promise<CalendarEvent[]> {
    const provider = this.resolveActiveProvider();
    if (!provider) return [];

    return await provider.getEventsForDate(date);
  }

  async connectGoogleCalendar(openUrl: (url: string) => void): Promise<void> {
    await this.nativeProvider.connect(openUrl);
  }

  async disconnectGoogleCalendar(): Promise<void> {
    await this.nativeProvider.disconnect();
  }

  async listGoogleCalendars(): Promise<Array<{ id: string; title: string; primary: boolean }>> {
    return await this.nativeProvider.listCalendars();
  }

  formatGoogleCalendarStatus(): string {
    const active = this.getActiveProviderId() ?? "none";
    const selected = this.settings.calendarProvider;
    const native = this.nativeProvider.formatStatus();

    return [`Selected provider mode: ${selected}`, `Active provider: ${active}`, native].join("\n");
  }

  /**
   * Resolve participant email to People note.
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
   * Create a People note for an email address.
   */
  async createPersonNote(email: string): Promise<TFile> {
    const displayName = this.emailToDisplayName(email);
    const path = `${this.settings.peopleFolder}/${displayName}.md`;

    const content = `---
email: ${email}
---

# ${displayName}
`;

    return await this.app.vault.create(path, content);
  }

  /**
   * Get or create a People note for an email.
   */
  async getOrCreatePerson(email: string): Promise<TFile> {
    const existing = await this.resolveParticipant(email);
    if (existing) return existing;

    return await this.createPersonNote(email);
  }

  private resolveActiveProvider(): CalendarProvider | null {
    const mode = this.settings.calendarProvider ?? "auto";

    if (mode === "plugin") {
      return this.pluginProvider.isAvailable() ? this.pluginProvider : null;
    }

    if (mode === "native") {
      return this.nativeProvider.isAvailable() ? this.nativeProvider : null;
    }

    // auto mode
    if (this.nativeProvider.isAvailable()) return this.nativeProvider;
    if (this.pluginProvider.isAvailable()) return this.pluginProvider;

    return null;
  }

  private emailToDisplayName(email: string): string {
    const localPart = email.split("@")[0];
    return localPart
      .split(/[._-]/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  }
}
