// ============================================================================
// Temporal Drift - Main Plugin Entry
// ============================================================================

import { Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
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
import { TaskIndexService } from "./services/task-index";
import { GoogleTasksSyncService } from "./services/google-tasks-sync";

export default class TemporalDriftPlugin extends Plugin {
  settings: TemporalDriftSettings = DEFAULT_SETTINGS;

  // Legacy compatibility for view module (view is no longer registered).
  lastActiveDailyNotePath: string | null = null;

  private autoTimestamp: AutoTimestampExtension | null = null;
  private timeline: TimelineExtension | null = null;
  private timelineLivePreview: TimelineLivePreviewExtension | null = null;
  private taskDrop: TaskDropExtension | null = null;
  private taskAllocationSync: TaskAllocationSync | null = null;
  private taskIndex: TaskIndexService | null = null;
  private googleTasksSync: GoogleTasksSyncService | null = null;
  private googleTasksIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();
    await this.reconcileFolderDefaults();

    this.autoTimestamp = new AutoTimestampExtension(this.settings);
    this.timeline = new TimelineExtension(this.settings);
    this.timelineLivePreview = new TimelineLivePreviewExtension(this.settings);
    this.taskDrop = new TaskDropExtension(this.settings);
    this.taskAllocationSync = new TaskAllocationSync(this.app, this.settings);

    this.taskIndex = new TaskIndexService(this.app, this.settings);
    await this.taskIndex.buildIndex();

    this.googleTasksSync = new GoogleTasksSyncService(this.app, this.settings, this.taskIndex, {
      onTokenUpdate: async (token) => {
        this.settings.googleTasksToken = token;
        await this.saveSettings();
      },
    });

    this.registerObsidianProtocolHandler("temporal-drift-oauth", async (params: any) => {
      const code = params?.code;
      if (!code) return;
      if (!this.googleTasksSync) return;

      await this.googleTasksSync.handleAuthCode(String(code));
    });

    // Markdown-first: all core UX lives in editor/preview extensions, no custom ItemView required.
    this.registerEditorExtension(this.buildEditorExtensions());
    registerTimelinePostProcessor(this);

    // External automation trigger file (vault-relative)
    registerOpenTrigger(this.app, { controlPath: "Temporal Drift/open.txt" });

    this.registerView(VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL, (leaf) =>
      new TemporalDriftTaskPoolView(leaf, this)
    );

    const onTaskFileEvent = async (file: TAbstractFile): Promise<void> => {
      if (!(file instanceof TFile)) return;

      // Local sync: task note -> daily note allocation propagation
      await this.taskAllocationSync?.syncFromTaskFile(file);

      // Index maintenance
      await this.taskIndex?.onFileModify(file);

      // Google Tasks sync
      this.googleTasksSync?.onVaultEvent(file);
    };

    this.registerEvent(this.app.vault.on("create", onTaskFileEvent));
    this.registerEvent(this.app.vault.on("modify", onTaskFileEvent));
    this.registerEvent(
      this.app.vault.on("rename", async (file, oldPath) => {
        if (!(file instanceof TFile)) return;

        await this.taskAllocationSync?.syncFromTaskFile(file);
        await this.taskIndex?.onFileRename(file, String(oldPath));
        this.googleTasksSync?.onVaultEvent(file);
      })
    );

    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile) {
          this.taskIndex?.onFileDelete(file);
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

    this.setupGoogleTasksAutoSync();
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

  private setupGoogleTasksAutoSync(): void {
    // Clear any prior interval
    if (this.googleTasksIntervalId) {
      window.clearInterval(this.googleTasksIntervalId);
      this.googleTasksIntervalId = null;
    }

    if (!this.googleTasksSync) return;
    if (!this.settings.googleTasksEnabled) return;
    if (!this.settings.googleTasksToken) return;

    const minutes = Number(this.settings.googleTasksAutoSyncMinutes ?? 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return;

    const ms = Math.max(60_000, minutes * 60_000);
    this.googleTasksIntervalId = window.setInterval(() => {
      this.googleTasksSync?.syncAll();
    }, ms);

    this.registerInterval(this.googleTasksIntervalId);
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
    this.taskIndex?.updateSettings(this.settings);
    this.googleTasksSync?.updateSettings(this.settings);

    this.setupGoogleTasksAutoSync();
  }

  async connectGoogleTasks(): Promise<void> {
    if (!this.googleTasksSync) return;

    if (!this.settings.googleTasksClientId || !this.settings.googleTasksClientSecret) {
      new Notice("[Temporal Drift] Set Google client id/secret in settings first", 4000);
      return;
    }

    // Opening an external URL from Obsidian is annoyingly inconsistent across platforms.
    const url = this.googleTasksSync.getAuthUrl();
    const openWithDefaultApp = (this.app as any).openWithDefaultApp as ((url: string) => void) | undefined;
    if (openWithDefaultApp) openWithDefaultApp(url);
    else window.open(url);

    new Notice("[Temporal Drift] Complete Google OAuth in your browser…", 4000);
  }

  async syncGoogleTasksNow(): Promise<void> {
    await this.googleTasksSync?.syncAll();
  }

  async disconnectGoogleTasks(): Promise<void> {
    await this.googleTasksSync?.disconnect();
  }

  async listGoogleTaskLists(): Promise<Array<{ id: string; title: string }>> {
    return (await this.googleTasksSync?.listTaskLists()) ?? [];
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
