import { CalendarEvent, TemporalDriftSettings } from "../../../types";

export type CalendarProviderId = "plugin" | "native";

export interface CalendarProvider {
  id: CalendarProviderId;
  updateSettings(settings: TemporalDriftSettings): void;
  isAvailable(): boolean;
  getEventsForDate(date: Date): Promise<CalendarEvent[]>;
  getSyncIntervalMs?(): number | null;
}
