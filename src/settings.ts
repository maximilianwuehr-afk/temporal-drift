// ============================================================================
// Temporal Drift Settings Tab
// ============================================================================

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type TemporalDriftPlugin from "./main";

export class TemporalDriftSettingTab extends PluginSettingTab {
  plugin: TemporalDriftPlugin;
  private statusIntervalId: number | null = null;

  constructor(app: App, plugin: TemporalDriftPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  private clearStatusInterval(): void {
    if (this.statusIntervalId !== null) {
      window.clearInterval(this.statusIntervalId);
      this.statusIntervalId = null;
    }
  }

  display(): void {
    this.clearStatusInterval();

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

    new Setting(containerEl)
      .setName("Organizations folder")
      .setDesc("Folder where organization notes are stored")
      .addText((text) =>
        text
          .setPlaceholder("Organizations")
          .setValue(this.plugin.settings.organizationsFolder)
          .onChange(async (value) => {
            this.plugin.settings.organizationsFolder = value || "Organizations";
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

    // Calendar section
    new Setting(containerEl).setName("Calendar Sync").setHeading();

    new Setting(containerEl)
      .setName("Calendar provider")
      .setDesc("auto = prefer native Google API, fall back to external Google Calendar plugin")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("auto", "Auto (recommended)")
          .addOption("plugin", "External plugin")
          .addOption("native", "Native Google API")
          .setValue(this.plugin.settings.calendarProvider)
          .onChange(async (value) => {
            this.plugin.settings.calendarProvider = value as "auto" | "plugin" | "native";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Google Calendar OAuth Client ID")
      .setDesc("Desktop app client id from Google Cloud Console.")
      .addText((text) =>
        text
          .setPlaceholder("xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com")
          .setValue(this.plugin.settings.googleCalendarClientId)
          .onChange(async (value) => {
            this.plugin.settings.googleCalendarClientId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Google Calendar OAuth Client Secret (optional)")
      .setDesc("Optional for installed apps; supported for compatibility.")
      .addText((text) => {
        text.inputEl.type = "password";
        return text
          .setPlaceholder("••••••••••••••••")
          .setValue(this.plugin.settings.googleCalendarClientSecret)
          .onChange(async (value) => {
            this.plugin.settings.googleCalendarClientSecret = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Google Calendar id")
      .setDesc("Leave empty for primary calendar.")
      .addText((text) =>
        text
          .setPlaceholder("primary")
          .setValue(this.plugin.settings.googleCalendarId)
          .onChange(async (value) => {
            this.plugin.settings.googleCalendarId = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Calendar auto-sync interval (minutes)")
      .setDesc("Used by native provider. 0 = manual only.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 30, 1)
          .setValue(this.plugin.settings.googleCalendarAutoSyncMinutes)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.googleCalendarAutoSyncMinutes = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Calendar status")
      .setDesc(this.plugin.formatGoogleCalendarStatus())
      .addButton((btn) =>
        btn.setButtonText("Refresh").onClick(() => {
          new Notice(this.plugin.formatGoogleCalendarStatus(), 6000);
        })
      );

    new Setting(containerEl)
      .setName("Calendar actions")
      .setDesc("Connect native Google Calendar, inspect calendars, or disconnect.")
      .addButton((btn) =>
        btn
          .setButtonText("Connect")
          .setCta()
          .onClick(async () => {
            await this.plugin.connectGoogleCalendar();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Show calendars").onClick(async () => {
          const calendars = await this.plugin.listGoogleCalendars();
          const msg =
            calendars.length === 0
              ? "No calendars (not authenticated yet)."
              : calendars
                  .map((c) => `${c.primary ? "★ " : ""}${c.title} — ${c.id}`)
                  .join("\n");
          new Notice(msg, 7000);
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Disconnect").onClick(async () => {
          await this.plugin.disconnectGoogleCalendar();
          new Notice("[Temporal Drift] Disconnected Google Calendar", 2500);
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

    // Automation section
    new Setting(containerEl).setName("Automation").setHeading();

    new Setting(containerEl)
      .setName("Enable OpenClaw automation")
      .setDesc("Allow command ingestion and Denethor queue writes.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.openClawAutomationEnabled).onChange(async (value) => {
          this.plugin.settings.openClawAutomationEnabled = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("OpenClaw commands path")
      .setDesc("NDJSON inbox watched for automation commands.")
      .addText((text) =>
        text
          .setPlaceholder("Temporal Drift/commands.ndjson")
          .setValue(this.plugin.settings.openClawCommandsPath)
          .onChange(async (value) => {
            this.plugin.settings.openClawCommandsPath = value || "Temporal Drift/commands.ndjson";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Denethor queue path")
      .setDesc("NDJSON outbox where research jobs are appended.")
      .addText((text) =>
        text
          .setPlaceholder("Temporal Drift/denethor-queue.ndjson")
          .setValue(this.plugin.settings.denethorQueuePath)
          .onChange(async (value) => {
            this.plugin.settings.denethorQueuePath = value || "Temporal Drift/denethor-queue.ndjson";
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Auto-research daily notes")
      .setDesc("Queue Denethor research when a new daily note is created.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.denethorAutoResearchDailyNotes).onChange(async (value) => {
          this.plugin.settings.denethorAutoResearchDailyNotes = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-research people notes")
      .setDesc("Queue Denethor research when a new People note is created.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.denethorAutoResearchPeople).onChange(async (value) => {
          this.plugin.settings.denethorAutoResearchPeople = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Auto-research organization notes")
      .setDesc("Queue Denethor research when a new organization note is created.")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.denethorAutoResearchOrganizations).onChange(async (value) => {
          this.plugin.settings.denethorAutoResearchOrganizations = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Google OAuth Client ID")
      .setDesc("Create an OAuth Client in Google Cloud Console (type: Desktop app / Installed). Temporal Drift uses a loopback redirect (127.0.0.1) + PKCE.")
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
      .setName("Google OAuth Client Secret (optional)")
      .setDesc("Optional. Desktop apps should not rely on a secret, but we allow it for compatibility.")
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

    const statusSetting = new Setting(containerEl)
      .setName("Sync status")
      .setDesc("Last run details, sync result, and current state.");

    const renderStatus = () => {
      const status = this.plugin.getGoogleTasksSyncStatus();
      const fmt = (ts: number | null) => (ts ? new Date(ts).toLocaleString() : "—");
      const state = status.inProgress ? "running" : status.state;
      const lines = [
        `State: ${state}`,
        `Last started: ${fmt(status.lastStartedAt)}`,
        `Last success: ${fmt(status.lastSuccessAt)}`,
        `Last finished: ${fmt(status.lastFinishedAt)}`,
      ];

      if (status.lastError) {
        lines.push(`Last error: ${status.lastError}`);
      }

      if (status.lastStats) {
        lines.push(
          `Stats: remote +${status.lastStats.remoteCreates}/~${status.lastStats.remotePatches}/=${status.lastStats.remoteNoops}, local +${status.lastStats.localCreates}/~${status.lastStats.localPulls}/=${status.lastStats.localNoops}, conflicts ${status.lastStats.conflicts}`
        );
      }

      statusSetting.setDesc(lines.join("\n"));
    };

    renderStatus();

    this.statusIntervalId = window.setInterval(() => {
      if (!this.containerEl.isConnected) {
        this.clearStatusInterval();
        return;
      }
      renderStatus();
    }, 1000);

    statusSetting.addButton((btn) =>
      btn.setButtonText("Refresh").onClick(() => {
        renderStatus();
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
            renderStatus();
          })
      )
      .addButton((btn) =>
        btn.setButtonText("Sync now").onClick(async () => {
          await this.plugin.syncGoogleTasksNow();
          renderStatus();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Preview").onClick(async () => {
          try {
            const summary = await this.plugin.previewGoogleTasksSync();
            new Notice(summary, 9000);
          } catch (error) {
            new Notice(`[Temporal Drift] Preview failed: ${String((error as any)?.message ?? error)}`, 5000);
          }
          renderStatus();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Disconnect").onClick(async () => {
          await this.plugin.disconnectGoogleTasks();
          renderStatus();
          new Notice("[Temporal Drift] Disconnected Google Tasks", 2500);
        })
      );
  }

  hide(): void {
    this.clearStatusInterval();
  }
}
