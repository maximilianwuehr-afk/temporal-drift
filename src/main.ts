// ============================================================================
// Temporal Drift - Main Plugin Entry
// ============================================================================

import { Plugin, MarkdownView } from "obsidian";
import { Extension } from "@codemirror/state";

import { DEFAULT_SETTINGS, TemporalDriftSettings } from "./types";
import { TemporalDriftSettingTab } from "./settings";
import { TimelineExtension } from "./editor/timeline-extension";
import { TimelineLivePreviewExtension } from "./editor/timeline-live-preview";
import { AutoTimestampExtension } from "./editor/auto-timestamp";
import { registerCommands } from "./commands";
import { formatDate, formatTime } from "./utils/time";
import { TemporalDriftView, VIEW_TYPE_TEMPORAL_DRIFT } from "./views/TemporalDriftView";
import { registerTimelinePostProcessor } from "./preview/timeline-postprocessor";

export default class TemporalDriftPlugin extends Plugin {
  settings: TemporalDriftSettings = DEFAULT_SETTINGS;

  // Last daily note the user was looking at (used when opening the custom view)
  lastActiveDailyNotePath: string | null = null;

  private autoTimestamp: AutoTimestampExtension | null = null;
  private timeline: TimelineExtension | null = null;
  private timelineLivePreview: TimelineLivePreviewExtension | null = null;

  async onload() {
    console.log("Loading Temporal Drift plugin");

    // Load settings
    await this.loadSettings();

    // Initialize extensions
    this.autoTimestamp = new AutoTimestampExtension(this.settings);
    this.timeline = new TimelineExtension(this.settings);
    this.timelineLivePreview = new TimelineLivePreviewExtension(this.settings);

    // Register CM6 extensions (raw editor mode)
    this.registerEditorExtension(this.buildEditorExtensions());

    // Register Temporal Drift custom view (legacy)
    this.registerView(VIEW_TYPE_TEMPORAL_DRIFT, (leaf) => new TemporalDriftView(leaf, this));

    // Reading view (Preview) renderer for timeline cards
    registerTimelinePostProcessor(this);

    // Register settings tab
    this.addSettingTab(new TemporalDriftSettingTab(this.app, this));

    // Track last active daily note (so the ItemView can open the correct date)
    const maybeRememberDailyNote = (file: any) => {
      if (!file || typeof file.path !== "string") return;
      const prefix = `${this.settings.dailyNotesFolder}/`;
      if (!file.path.startsWith(prefix)) return;
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(file.name)) return;
      this.lastActiveDailyNotePath = file.path;
    };

    // Seed on startup (active file)
    maybeRememberDailyNote(this.app.workspace.getActiveFile());

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        const view = leaf?.view;
        // MarkdownView import avoided here; check shape.
        const file = (view as any)?.file;
        maybeRememberDailyNote(file);
      })
    );

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        maybeRememberDailyNote(file);
      })
    );

    // Register commands
    registerCommands(this);

    // Open Temporal Drift view
    this.addCommand({
      id: "open-temporal-drift",
      name: "Open Temporal Drift",
      callback: async () => {
        await this.activateView();
      },
    });

    this.addRibbonIcon("clock", "Temporal Drift", async () => {
      await this.activateView();
    });

    // Quick add timestamp command
    this.addCommand({
      id: "add-timestamp",
      name: "Add timestamp at cursor",
      editorCallback: (editor) => {
        const timestamp = `${formatTime(new Date())} `;
        editor.replaceSelection(timestamp);
      },
    });

    // Create daily note command
    this.addCommand({
      id: "create-daily-note",
      name: "Create daily note",
      callback: () => this.createDailyNote(),
    });
  }

  buildEditorExtensions(): Extension[] {
    const extensions: Extension[] = [];

    if (this.timeline) {
      extensions.push(...this.timeline.getExtension());
    }

    // Live Preview rich cards (only active in Live Preview mode)
    if (this.timelineLivePreview) {
      extensions.push(...this.timelineLivePreview.getExtension());
    }

    if (this.autoTimestamp) {
      extensions.push(...this.autoTimestamp.getExtension());
    }

    return extensions;
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);

    // Update extensions with new settings
    this.autoTimestamp?.updateSettings(this.settings);
    this.timeline?.updateSettings(this.settings);
    this.timelineLivePreview?.updateSettings(this.settings);
  }

  async createDailyNote() {
    const date = new Date();
    const dateStr = formatDate(date);
    const filename = `${this.settings.dailyNotesFolder}/${dateStr}.md`;

    const template = `# ${dateStr}

## Thankful for


## Focus


${formatTime(date)} `;

    const file = this.app.vault.getAbstractFileByPath(filename);
    if (file) {
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(file as any);
    } else {
      const newFile = await this.app.vault.create(filename, template);
      const leaf = this.app.workspace.getLeaf();
      await leaf.openFile(newFile);
    }
  }

  async activateView(): Promise<void> {
    // Capture the currently-active daily note BEFORE switching focus to the ItemView.
    const activeMarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const activeMarkdownFile = activeMarkdownView?.file ?? this.app.workspace.getActiveFile();

    if (activeMarkdownFile) {
      const prefix = `${this.settings.dailyNotesFolder}/`;
      if (
        typeof activeMarkdownFile.path === "string" &&
        activeMarkdownFile.path.startsWith(prefix) &&
        /^\d{4}-\d{2}-\d{2}\.md$/.test(activeMarkdownFile.name)
      ) {
        this.lastActiveDailyNotePath = activeMarkdownFile.path;
      }
    }

    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState({ type: VIEW_TYPE_TEMPORAL_DRIFT, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TEMPORAL_DRIFT);
  }
}
