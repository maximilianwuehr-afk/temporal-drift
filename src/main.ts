// ============================================================================
// Temporal Drift - Main Plugin
// ============================================================================

import { Plugin, WorkspaceLeaf } from "obsidian";
import { TemporalDriftSettings, DEFAULT_SETTINGS, SettingsAware } from "./types";
import { deepMerge } from "./utils/deep-merge";
import { DailyNoteService } from "./services/daily-note";
import { TemporalDriftView, VIEW_TYPE_TEMPORAL_DRIFT } from "./views/temporal-drift-view";
import { TemporalDriftSettingTab } from "./settings";
import { registerCommands } from "./commands";
import { registerProtocolHandlers } from "./event-handlers";
import { AutoTimestampExtension } from "./decorators/auto-timestamp";

export default class TemporalDriftPlugin extends Plugin {
  settings: TemporalDriftSettings = DEFAULT_SETTINGS;
  private dailyNoteService: DailyNoteService | null = null;
  private autoTimestampExtension: AutoTimestampExtension | null = null;
  private settingsAwareComponents: SettingsAware[] = [];

  async onload(): Promise<void> {
    await this.loadSettings();

    // Initialize services
    this.dailyNoteService = new DailyNoteService(this.app, this.settings);
    this.registerSettingsAware(this.dailyNoteService);

    // Register view
    this.registerView(VIEW_TYPE_TEMPORAL_DRIFT, (leaf) => {
      const view = new TemporalDriftView(
        leaf,
        this.app,
        this.settings,
        this.dailyNoteService!
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
  }

  onunload(): void {
    // Clean up views
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT);
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
