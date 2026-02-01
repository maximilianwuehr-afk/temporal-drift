// ============================================================================
// Temporal Drift - Main Plugin
// ============================================================================

import { Plugin, WorkspaceLeaf, TFile } from "obsidian";
import { TemporalDriftSettings, DEFAULT_SETTINGS, SettingsAware } from "./types";
import { deepMerge } from "./utils/deep-merge";
import { DailyNoteService } from "./services/daily-note";
import { CalendarService } from "./services/calendar";
import { TaskIndexService } from "./services/task-index";
import { GoogleTasksSyncService } from "./services/google-tasks-sync";
import { TemporalDriftView, VIEW_TYPE_TEMPORAL_DRIFT } from "./views/temporal-drift-view";
import { TaskSidebarView, VIEW_TYPE_TASK_SIDEBAR } from "./views/task-sidebar-view";
import { TemporalDriftSettingTab } from "./settings";
import { registerCommands } from "./commands";
import { registerProtocolHandlers } from "./event-handlers";
import { AutoTimestampExtension } from "./decorators/auto-timestamp";

export default class TemporalDriftPlugin extends Plugin {
  settings: TemporalDriftSettings = DEFAULT_SETTINGS;
  private dailyNoteService: DailyNoteService | null = null;
  private calendarService: CalendarService | null = null;
  private taskIndexService: TaskIndexService | null = null;
  private googleTasksSyncService: GoogleTasksSyncService | null = null;
  private autoTimestampExtension: AutoTimestampExtension | null = null;
  private settingsAwareComponents: SettingsAware[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services
    this.dailyNoteService = new DailyNoteService(this.app, this.settings);
    this.registerSettingsAware(this.dailyNoteService);

    this.calendarService = new CalendarService(this.app, this.settings);
    this.registerSettingsAware(this.calendarService);

    this.taskIndexService = new TaskIndexService(this.app, this.settings);
    this.registerSettingsAware(this.taskIndexService);

    this.googleTasksSyncService = new GoogleTasksSyncService(
      this.app,
      this.settings,
      this.taskIndexService
    );
    this.registerSettingsAware(this.googleTasksSyncService);

    // Build task index when layout is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.taskIndexService!.buildIndex();
    });

    // Listen for file changes to update task index
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile) {
          await this.taskIndexService?.onFileModify(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.taskIndexService?.onFileDelete(file);
        }
      })
    );
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (file instanceof TFile) {
          await this.taskIndexService?.onFileRename(file, oldPath);
        }
      })
    );

    // Register views
    this.registerView(VIEW_TYPE_TEMPORAL_DRIFT, (leaf) => {
      const view = new TemporalDriftView(
        leaf,
        this.app,
        this.settings,
        this.dailyNoteService!,
        this.calendarService!
      );
      this.registerSettingsAware(view);
      return view;
    });

    this.registerView(VIEW_TYPE_TASK_SIDEBAR, (leaf) => {
      const view = new TaskSidebarView(
        leaf,
        this.app,
        this.settings,
        this.taskIndexService!
      );
      this.registerSettingsAware(view);
      return view;
    });

    // Register commands
    registerCommands(this);

    // Register protocol handlers
    registerProtocolHandlers(
      this.app,
      this.dailyNoteService,
      () => this.activateView()
    );

    // Register auto-timestamp extension
    this.autoTimestampExtension = new AutoTimestampExtension(this.settings);
    this.registerEditorExtension(this.autoTimestampExtension.getExtension());

    // Add settings tab
    this.addSettingTab(new TemporalDriftSettingTab(this.app, this));

    // Add ribbon icon
    this.addRibbonIcon("clock", "Temporal Drift", async () => {
      await this.activateView();
    });

    // Expose Templater API
    this.exposeTemplaterAPI();
  }

  /**
   * Expose API for Templater integration
   */
  private exposeTemplaterAPI(): void {
    (this as any).api = {
      // Create daily note and return path
      createDailyNote: async (tp: any): Promise<string> => {
        const file = await this.dailyNoteService!.openToday();
        return file.path;
      },

      // Get daily note path for a date
      getDailyNotePath: (date: string): string => {
        return `${this.settings.dailyNotesFolder}/${date}.md`;
      },

      // Add entry to daily note
      addEntry: async (date: string, time: string, text: string): Promise<void> => {
        await this.dailyNoteService!.appendEntry(date, time, text);
      },

      // Create task and return path
      createTask: async (title: string, priority?: "now" | "next" | "later"): Promise<string> => {
        const file = await this.taskIndexService!.createTask(title, priority);
        return file.path;
      },

      // Get tasks by priority
      getTasksByPriority: (priority: "now" | "next" | "later"): any[] => {
        return this.taskIndexService!.getByPriority(priority);
      },

      // Get today's date formatted
      today: (): string => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      },

      // Get current time formatted
      now: (): string => {
        const d = new Date();
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      },
    };
  }

  onunload(): void {
    // Clean up views
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT);
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TASK_SIDEBAR);
    this.settingsAwareComponents = [];
  }

  async loadSettings(): Promise<void> {
    const loaded = await this.loadData();
    this.settings = deepMerge(DEFAULT_SETTINGS, loaded || {});
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    this.notifySettingsChange();
  }

  /**
   * Register a component that needs settings updates
   */
  private registerSettingsAware(component: SettingsAware): void {
    this.settingsAwareComponents.push(component);
  }

  /**
   * Notify all registered components of settings changes
   */
  private notifySettingsChange(): void {
    for (const component of this.settingsAwareComponents) {
      component.updateSettings(this.settings);
    }
    // Also update auto-timestamp extension
    this.autoTimestampExtension?.updateSettings(this.settings);
  }

  /**
   * Get the daily note service
   */
  getDailyNoteService(): DailyNoteService {
    if (!this.dailyNoteService) {
      throw new Error("DailyNoteService not initialized");
    }
    return this.dailyNoteService;
  }

  /**
   * Get the calendar service
   */
  getCalendarService(): CalendarService {
    if (!this.calendarService) {
      throw new Error("CalendarService not initialized");
    }
    return this.calendarService;
  }

  /**
   * Get the task index service
   */
  getTaskIndexService(): TaskIndexService {
    if (!this.taskIndexService) {
      throw new Error("TaskIndexService not initialized");
    }
    return this.taskIndexService;
  }

  /**
   * Get the Google Tasks sync service
   */
  getGoogleTasksSyncService(): GoogleTasksSyncService {
    if (!this.googleTasksSyncService) {
      throw new Error("GoogleTasksSyncService not initialized");
    }
    return this.googleTasksSyncService;
  }

  /**
   * Activate the Temporal Drift view
   */
  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT);

    if (existing.length > 0) {
      // View exists, reveal it
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    // Create new view in right sidebar
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_TEMPORAL_DRIFT,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Activate the Task Sidebar view
   */
  async activateTaskSidebar(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TASK_SIDEBAR);

    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({
        type: VIEW_TYPE_TASK_SIDEBAR,
        active: true,
      });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  /**
   * Get the active Temporal Drift view if it exists
   */
  getView(): TemporalDriftView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT);
    if (leaves.length > 0) {
      return leaves[0].view as TemporalDriftView;
    }
    return null;
  }
}
