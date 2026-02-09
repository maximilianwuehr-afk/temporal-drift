// ============================================================================
// Temporal Drift Settings Tab
// ============================================================================

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TemporalDriftPlugin from "./main";

export class TemporalDriftSettingTab extends PluginSettingTab {
  plugin: TemporalDriftPlugin;

  constructor(app: App, plugin: TemporalDriftPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Folders section
    new Setting(containerEl).setName("Folders").setHeading();

    new Setting(containerEl)
      .setName("Daily notes folder")
      .setDesc("Folder where daily notes are stored")
      .addText((text) =>
        text
          .setPlaceholder("Daily notes")
          .setValue(this.plugin.settings.dailyNotesFolder)
          .onChange(async (value) => {
            this.plugin.settings.dailyNotesFolder = value || "Daily notes";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Tasks folder")
      .setDesc("Folder where task notes are stored")
      .addText((text) =>
        text
          .setPlaceholder("Tasks")
          .setValue(this.plugin.settings.tasksFolder)
          .onChange(async (value) => {
            this.plugin.settings.tasksFolder = value || "Tasks";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Meetings folder")
      .setDesc("Folder where meeting notes are stored")
      .addText((text) =>
        text
          .setPlaceholder("Meetings")
          .setValue(this.plugin.settings.meetingsFolder)
          .onChange(async (value) => {
            this.plugin.settings.meetingsFolder = value || "Meetings";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("People folder")
      .setDesc("Folder where people notes are stored")
      .addText((text) =>
        text
          .setPlaceholder("People")
          .setValue(this.plugin.settings.peopleFolder)
          .onChange(async (value) => {
            this.plugin.settings.peopleFolder = value || "People";
            await this.plugin.saveSettings();
          })
      );

    // Display section
    new Setting(containerEl).setName("Display").setHeading();

    new Setting(containerEl)
      .setName("Calendar days")
      .setDesc("Number of days to show in the calendar strip")
      .addSlider((slider) =>
        slider
          .setLimits(5, 14, 1)
          .setValue(this.plugin.settings.calendarDays)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.calendarDays = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show thankful section")
      .setDesc("Display the 'Thankful for' section in daily notes")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showThankful).onChange(async (value) => {
          this.plugin.settings.showThankful = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Show focus section")
      .setDesc("Display the 'Focus' section in daily notes")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showFocus).onChange(async (value) => {
          this.plugin.settings.showFocus = value;
          await this.plugin.saveSettings();
        })
      );

    // Tasks section
    new Setting(containerEl).setName("Tasks").setHeading();

    new Setting(containerEl)
      .setName("Default priority")
      .setDesc("Default priority for new tasks")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("now", "Now")
          .addOption("next", "Next")
          .addOption("later", "Later")
          .setValue(this.plugin.settings.defaultPriority)
          .onChange(async (value) => {
            this.plugin.settings.defaultPriority = value as "now" | "next" | "later";
            await this.plugin.saveSettings();
          })
      );

    // Google Tasks section
    new Setting(containerEl).setName("Google Tasks Sync").setHeading();

    new Setting(containerEl)
      .setName("Enable Google Tasks sync")
      .setDesc("Two-way sync between Tasks/ notes and your Google Tasks list.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.googleTasksEnabled).onChange(async (value) => {
          this.plugin.settings.googleTasksEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Google OAuth Client ID")
      .setDesc("Create an OAuth Client in Google Cloud Console. Redirect URI: obsidian://temporal-drift-oauth")
      .addText((text) =>
        text
          .setPlaceholder("xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com")
          .setValue(this.plugin.settings.googleTasksClientId)
          .onChange(async (value) => {
            this.plugin.settings.googleTasksClientId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Google OAuth Client Secret")
      .setDesc("Stored locally in your vault plugin data. Treat it like a password.")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("••••••••••••••••")
          .setValue(this.plugin.settings.googleTasksClientSecret)
          .onChange(async (value) => {
            this.plugin.settings.googleTasksClientSecret = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Google Tasks list id (optional)")
      .setDesc("Leave empty to use your first/default list.")
      .addText((text) =>
        text
          .setPlaceholder("")
          .setValue(this.plugin.settings.googleTasksListId)
          .onChange(async (value) => {
            this.plugin.settings.googleTasksListId = value.trim();
            await this.plugin.saveSettings();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Show lists").onClick(async () => {
          const lists = await this.plugin.listGoogleTaskLists();
          const msg =
            lists.length === 0
              ? "No lists (not authenticated yet)."
              : lists.map((l) => `${l.title} — ${l.id}`).join("\n");
          new Notice(msg, 6000);
        })
      );

    new Setting(containerEl)
      .setName("Auto-sync interval (minutes)")
      .setDesc("0 = manual only. Recommended: 5.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 30, 1)
          .setValue(this.plugin.settings.googleTasksAutoSyncMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.googleTasksAutoSyncMinutes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Actions")
      .setDesc("Connect, sync now, or disconnect.")
      .addButton((btn) =>
        btn
          .setButtonText("Connect")
          .setCta()
          .onClick(async () => {
            await this.plugin.connectGoogleTasks();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Sync now").onClick(async () => {
          await this.plugin.syncGoogleTasksNow();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Disconnect").onClick(async () => {
          await this.plugin.disconnectGoogleTasks();
          new Notice("[Temporal Drift] Disconnected Google Tasks", 2500);
        })
      );
  }
}
