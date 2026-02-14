// ============================================================================
// Temporal Drift - Types and Settings
// ============================================================================

// ============================================================================
// Settings
// ============================================================================

export interface GoogleOAuthToken {
  access_token: string;
  refresh_token: string;
  expires_at: number;
}

export type GoogleTasksToken = GoogleOAuthToken;

export interface GoogleTasksSyncStats {
  remoteCreates: number;
  remotePatches: number;
  remoteNoops: number;
  localCreates: number;
  localPulls: number;
  localNoops: number;
  conflicts: number;
}

export interface GoogleTasksSyncStatus {
  state: "idle" | "running" | "success" | "failed";
  inProgress: boolean;
  lastStartedAt: number | null;
  lastFinishedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  lastStats: GoogleTasksSyncStats | null;
}

export interface TemporalDriftSettings {
  dailyNotesFolder: string;
  tasksFolder: string;
  meetingsFolder: string;
  peopleFolder: string;
  organizationsFolder: string;
  defaultPriority: "now" | "next" | "later";
  themeMode: "light" | "dark" | "system";
  showThankful: boolean;
  showFocus: boolean;
  calendarDays: number;

  // Calendar provider
  calendarProvider: "auto" | "plugin" | "native";

  // Native Google Calendar (optional)
  googleCalendarClientId: string;
  googleCalendarClientSecret: string;
  googleCalendarToken: GoogleOAuthToken | null;
  googleCalendarId: string; // empty => primary
  googleCalendarAutoSyncMinutes: number; // 0 => manual only

  // Google Tasks Sync (optional)
  googleTasksEnabled: boolean;
  googleTasksClientId: string;
  googleTasksClientSecret: string; // optional (desktop apps should prefer PKCE; secret is not truly secret)
  googleTasksToken: GoogleTasksToken | null;
  googleTasksListId: string; // empty => use first list
  googleTasksAutoSyncMinutes: number; // 0 => manual only

  // OpenClaw / Denethor automation (optional)
  openClawAutomationEnabled: boolean;
  openClawCommandsPath: string; // NDJSON command inbox
  denethorQueuePath: string; // NDJSON queue for research jobs
  denethorAutoResearchDailyNotes: boolean;
  denethorAutoResearchPeople: boolean;
  denethorAutoResearchOrganizations: boolean;
}

export const DEFAULT_SETTINGS: TemporalDriftSettings = {
  dailyNotesFolder: "Daily notes",
  tasksFolder: "Tasks",
  meetingsFolder: "Meetings",
  peopleFolder: "People",
  organizationsFolder: "Organizations",
  defaultPriority: "now",
  themeMode: "system",
  showThankful: true,
  showFocus: true,
  calendarDays: 7,

  calendarProvider: "auto",

  googleCalendarClientId: "",
  googleCalendarClientSecret: "",
  googleCalendarToken: null,
  googleCalendarId: "",
  googleCalendarAutoSyncMinutes: 5,

  googleTasksEnabled: false,
  googleTasksClientId: "",
  googleTasksClientSecret: "",
  googleTasksToken: null,
  googleTasksListId: "",
  googleTasksAutoSyncMinutes: 5,

  openClawAutomationEnabled: true,
  openClawCommandsPath: "Temporal Drift/commands.ndjson",
  denethorQueuePath: "Temporal Drift/denethor-queue.ndjson",
  denethorAutoResearchDailyNotes: true,
  denethorAutoResearchPeople: true,
  denethorAutoResearchOrganizations: true,
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

  // Sync metadata (optional)
  googleTaskId?: string;
  googleEtag?: string;
  googleLastSynced?: number;
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
