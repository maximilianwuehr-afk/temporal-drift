// ============================================================================
// Temporal Drift - Types and Settings
// ============================================================================

// ============================================================================
// Settings
// ============================================================================

export interface TemporalDriftSettings {
  dailyNotesFolder: string;
  tasksFolder: string;
  meetingsFolder: string;
  peopleFolder: string;
  defaultPriority: "now" | "next" | "later";
  themeMode: "light" | "dark" | "system";
  showThankful: boolean;
  showFocus: boolean;
  calendarDays: number;
}

export const DEFAULT_SETTINGS: TemporalDriftSettings = {
  dailyNotesFolder: "Daily notes",
  tasksFolder: "Tasks",
  meetingsFolder: "Meetings",
  peopleFolder: "People",
  defaultPriority: "now",
  themeMode: "system",
  showThankful: true,
  showFocus: true,
  calendarDays: 7,
};

// ============================================================================
// Settings Aware Interface
// ============================================================================

export interface SettingsAware {
  updateSettings(settings: TemporalDriftSettings): void;
}

// ============================================================================
// Timeline Types
// ============================================================================

export type TimeEntry =
  | { type: "task"; time: string; content: string; status: "open" | "done"; taskPath?: string }
  | { type: "note"; time: string; content: string }
  | { type: "event"; time: string; title: string; eventId: string; participants?: Participant[] };

export interface ParsedDay {
  date: string;
  path: string;
  mtime: number;
  entries: TimeEntry[];
  thankful?: string;
  focus?: string;
}

// ============================================================================
// Task Types
// ============================================================================

export interface TaskMeta {
  path: string;
  title: string;
  status: "open" | "done";
  priority: "now" | "next" | "later";
  due?: string;
  created?: string;
}

// ============================================================================
// Calendar Types
// ============================================================================

export interface Participant {
  name: string;
  email: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  participants: Participant[];
  description?: string;
  location?: string;
}
