// ============================================================================
// Temporal Drift - Main Plugin Entry
// ============================================================================

import { Plugin, TAbstractFile, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import { Extension } from "@codemirror/state";

import { DEFAULT_SETTINGS, TemporalDriftSettings } from "./types";
import { TemporalDriftSettingTab } from "./settings";
import { TimelineExtension } from "./editor/timeline-extension";
import { TimelineLivePreviewExtension } from "./editor/timeline-live-preview";
import { AutoTimestampExtension } from "./editor/auto-timestamp";
import { registerCommands } from "./commands";
import { formatDate, formatTime } from "./utils/time";
import { registerTimelinePostProcessor } from "./preview/timeline-postprocessor";
import { registerOpenTrigger } from "./automation/open-trigger";
import { TaskDropExtension } from "./editor/task-drop";
import { TemporalDriftTaskPoolView, VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL } from "./views/task-pool-view";
import { TaskAllocationSync } from "./services/task-allocation-sync";

export default class TemporalDriftPlugin extends Plugin {
  settings: TemporalDriftSettings = DEFAULT_SETTINGS;

  // Legacy compatibility for view module (view is no longer registered).
  lastActiveDailyNotePath: string | null = null;

  private autoTimestamp: AutoTimestampExtension | null = null;
  private timeline: TimelineExtension | null = null;
  private timelineLivePreview: TimelineLivePreviewExtension | null = null;
  private taskDrop: TaskDropExtension | null = null;
  private taskAllocationSync: TaskAllocationSync | null = null;

  async onload() {
    await this.loadSettings();
    await this.reconcileFolderDefaults();

    this.autoTimestamp = new AutoTimestampExtension(this.settings);
    this.timeline = new TimelineExtension(this.settings);
    this.timelineLivePreview = new TimelineLivePreviewExtension(this.settings);
    this.taskDrop = new TaskDropExtension(this.settings);
    this.taskAllocationSync = new TaskAllocationSync(this.app, this.settings);

    // Markdown-first: all core UX lives in editor/preview extensions, no custom ItemView required.
    this.registerEditorExtension(this.buildEditorExtensions());
    registerTimelinePostProcessor(this);

    // External automation trigger file (vault-relative)
    registerOpenTrigger(this.app, { controlPath: "Temporal Drift/open.txt" });

    this.registerView(VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL, (leaf) =>
      new TemporalDriftTaskPoolView(leaf, this)
    );

    const syncTaskFile = async (file: TAbstractFile): Promise<void> => {
      if (!(file instanceof TFile)) return;
      await this.taskAllocationSync?.syncFromTaskFile(file);
    };

    this.registerEvent(this.app.vault.on("create", syncTaskFile));
    this.registerEvent(this.app.vault.on("modify", syncTaskFile));
    this.registerEvent(
      this.app.vault.on("rename", async (file) => {
        if (file instanceof TFile) {
          await this.taskAllocationSync?.syncFromTaskFile(file);
        }
      })
    );

    this.addSettingTab(new TemporalDriftSettingTab(this.app, this));

    registerCommands(this);

    this.addCommand({
      id: "add-timestamp",
      name: "Add timestamp at cursor",
      editorCallback: (editor) => {
        const timestamp = `${formatTime(new Date())} `;
        editor.replaceSelection(timestamp);
      },
    });

    this.addCommand({
      id: "create-daily-note",
      name: "Create daily note",
      callback: () => this.createDailyNote(),
    });

    this.addCommand({
      id: "open-task-pool",
      name: "Open task pool",
      callback: async () => this.activateTaskPool(),
    });
  }

  private async reconcileFolderDefaults(): Promise<void> {
    let changed = false;

    const reconcile = (key: keyof TemporalDriftSettings, fallback: string) => {
      const configured = normalizePath(String(this.settings[key] ?? ""));
      const configuredExists = configured.length > 0 && !!this.app.vault.getAbstractFileByPath(configured);
      const fallbackExists = !!this.app.vault.getAbstractFileByPath(normalizePath(fallback));

      if (!configuredExists && fallbackExists) {
        if (key === "dailyNotesFolder") this.settings.dailyNotesFolder = fallback;
        if (key === "tasksFolder") this.settings.tasksFolder = fallback;
        if (key === "meetingsFolder") this.settings.meetingsFolder = fallback;
        if (key === "peopleFolder") this.settings.peopleFolder = fallback;
        changed = true;
      }
    };

    reconcile("dailyNotesFolder", "Daily notes");
    reconcile("tasksFolder", "Tasks");
    reconcile("meetingsFolder", "Meetings");
    reconcile("peopleFolder", "People");

    if (changed) {
      await this.saveData(this.settings);
    }
  }

  buildEditorExtensions(): Extension[] {
    const extensions: Extension[] = [];

    if (this.timeline) {
      extensions.push(...this.timeline.getExtension());
    }

    if (this.timelineLivePreview) {
      extensions.push(...this.timelineLivePreview.getExtension());
    }

    if (this.autoTimestamp) {
      extensions.push(...this.autoTimestamp.getExtension());
    }

    if (this.taskDrop) {
      extensions.push(...this.taskDrop.getExtension());
    }

    return extensions;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);

    this.autoTimestamp?.updateSettings(this.settings);
    this.timeline?.updateSettings(this.settings);
    this.timelineLivePreview?.updateSettings(this.settings);
    this.taskDrop?.updateSettings(this.settings);
    this.taskAllocationSync?.updateSettings(this.settings);
  }

  private async activateTaskPool(): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;

    const leaves = workspace.getLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL);
    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL, active: true });
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
      workspace.setActiveLeaf(leaf, { focus: true });
    }
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL);
  }

  async createDailyNote() {
    const date = new Date();
    const dateStr = formatDate(date);
    const folderPath = normalizePath(this.settings.dailyNotesFolder);
    const filename = normalizePath(`${folderPath}/${dateStr}.md`);

    const template = `# ${dateStr}

## Thankful for


## Focus


${formatTime(date)} `;

    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
    }

    const file = this.app.vault.getAbstractFileByPath(filename);
    if (file instanceof TFile) {
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(file);
    } else {
      const newFile = await this.app.vault.create(filename, template);
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(newFile);
    }
  }
}
