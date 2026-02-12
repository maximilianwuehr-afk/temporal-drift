// ============================================================================
// Google Calendar - HTTP Client
// ============================================================================

import { requestUrl } from "obsidian";

import { CalendarEvent, Participant } from "../../../types";
import { GoogleAuthSession } from "../auth/google-auth-session";

interface GoogleCalendarList {
  id: string;
  summary: string;
  primary?: boolean;
}

interface GoogleCalendarDateRange {
  start: Date;
  end: Date;
}

export class GoogleCalendarClient {
  private auth: GoogleAuthSession;

  constructor(auth: GoogleAuthSession) {
    this.auth = auth;
  }

  async listCalendars(): Promise<Array<{ id: string; title: string; primary: boolean }>> {
    const accessToken = await this.auth.getAccessToken();

    const response = await requestUrl({
      url: "https://www.googleapis.com/calendar/v3/users/me/calendarList",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const items = ((response.json as any).items ?? []) as GoogleCalendarList[];

    return items.map((item) => ({
      id: String(item.id ?? ""),
      title: String(item.summary ?? item.id ?? ""),
      primary: Boolean(item.primary),
    }));
  }

  async listEventsForDate(calendarId: string, date: Date): Promise<CalendarEvent[]> {
    const accessToken = await this.auth.getAccessToken();
    const range = this.buildDateRange(date);

    const url =
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events` +
      `?singleEvents=true&orderBy=startTime&maxResults=2500&` +
      `timeMin=${encodeURIComponent(range.start.toISOString())}&` +
      `timeMax=${encodeURIComponent(range.end.toISOString())}`;

    const response = await requestUrl({
      url,
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const items = ((response.json as any).items ?? []) as any[];
    return items.map((item) => this.mapEvent(item));
  }

  private buildDateRange(date: Date): GoogleCalendarDateRange {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);

    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    return { start, end };
  }

  private mapEvent(event: any): CalendarEvent {
    const start = this.parseDateTime(event?.start);
    const end = this.parseDateTime(event?.end);

    return {
      id: String(event?.id ?? ""),
      title: String(event?.summary ?? event?.title ?? ""),
      start,
      end,
      participants: this.extractParticipants(event),
      location: typeof event?.location === "string" ? event.location : undefined,
      description: typeof event?.description === "string" ? event.description : undefined,
    };
  }

  private parseDateTime(raw: any): Date {
    const dateTime = typeof raw?.dateTime === "string" ? raw.dateTime : "";
    if (dateTime) return new Date(dateTime);

    const date = typeof raw?.date === "string" ? raw.date : "";
    if (date) return new Date(`${date}T00:00:00`);

    return new Date();
  }

  private extractParticipants(event: any): Participant[] {
    const attendees = Array.isArray(event?.attendees) ? event.attendees : [];

    return attendees
      .filter((a: any) => !a?.resource && !a?.self)
      .map((a: any) => ({
        name: a?.displayName || this.emailToDisplayName(String(a?.email ?? "")),
        email: String(a?.email ?? ""),
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
