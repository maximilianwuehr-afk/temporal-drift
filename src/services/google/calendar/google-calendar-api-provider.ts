// ============================================================================
// Google Calendar - Native API Provider
// ============================================================================

import { Notice } from "obsidian";

import { CalendarEvent, TemporalDriftSettings } from "../../../types";
import { GoogleAuthSession } from "../auth/google-auth-session";
import { GoogleOAuthToken } from "../auth/types";
import { GoogleCalendarClient } from "./google-calendar-client";
import { CalendarProvider } from "./provider-types";

interface GoogleCalendarApiProviderOptions {
  onTokenUpdate: (token: GoogleOAuthToken | null) => Promise<void>;
}

export class GoogleCalendarApiProvider implements CalendarProvider {
  readonly id = "native" as const;

  private settings: TemporalDriftSettings;
  private auth: GoogleAuthSession;
  private client: GoogleCalendarClient;

  constructor(settings: TemporalDriftSettings, options: GoogleCalendarApiProviderOptions) {
    this.settings = settings;
    this.auth = new GoogleAuthSession({
      scope: "https://www.googleapis.com/auth/calendar.readonly",
      token: settings.googleCalendarToken,
      getClientId: () => this.settings.googleCalendarClientId,
      getClientSecret: () => this.settings.googleCalendarClientSecret,
      onTokenUpdate: options.onTokenUpdate,
    });
    this.client = new GoogleCalendarClient(this.auth);
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.auth.updateToken(settings.googleCalendarToken);
  }

  isAvailable(): boolean {
    return !!(this.settings.googleCalendarClientId?.trim() && this.settings.googleCalendarToken);
  }

  getSyncIntervalMs(): number | null {
    const minutes = Number(this.settings.googleCalendarAutoSyncMinutes ?? 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return null;

    return Math.max(60_000, minutes * 60_000);
  }

  async getEventsForDate(date: Date): Promise<CalendarEvent[]> {
    if (!this.isAvailable()) return [];

    try {
      return await this.client.listEventsForDate(this.resolveCalendarId(), date);
    } catch (error) {
      console.warn("Temporal Drift: Failed to fetch calendar events from native Google API", error);
      return [];
    }
  }

  async connect(openUrl: (url: string) => void): Promise<void> {
    if (!this.settings.googleCalendarClientId?.trim()) {
      new Notice("[Temporal Drift] Missing Google Calendar Client ID", 4000);
      return;
    }

    await this.auth.beginAuthFlow(openUrl);
  }

  async disconnect(): Promise<void> {
    await this.auth.disconnect();
  }

  async listCalendars(): Promise<Array<{ id: string; title: string; primary: boolean }>> {
    if (!this.settings.googleCalendarToken) return [];
    return await this.client.listCalendars();
  }

  formatStatus(): string {
    const token = this.settings.googleCalendarToken;
    const exp = token ? new Date(token.expires_at).toLocaleString() : "—";

    return [
      `Provider: native-google`,
      `Configured client id: ${this.settings.googleCalendarClientId?.trim() ? "yes" : "no"}`,
      `Authenticated: ${token ? "yes" : "no"}`,
      `Calendar id: ${this.resolveCalendarId()}`,
      `Token expires: ${exp}`,
    ].join("\n");
  }

  private resolveCalendarId(): string {
    const id = this.settings.googleCalendarId?.trim();
    return id || "primary";
  }
}
