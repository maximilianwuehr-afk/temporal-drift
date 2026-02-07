// ============================================================================
// Temporal Drift - Main Plugin Entry
// ============================================================================

import { Plugin, TFile, normalizePath } from "obsidian";
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

export default class TemporalDriftPlugin extends Plugin {
  settings: TemporalDriftSettings = DEFAULT_SETTINGS;

  // Legacy compatibility for view module (view is no longer registered).
  lastActiveDailyNotePath: string | null = null;

  private autoTimestamp: AutoTimestampExtension | null = null;
  private timeline: TimelineExtension | null = null;
  private timelineLivePreview: TimelineLivePreviewExtension | null = null;

  async onload() {
    await this.loadSettings();

    this.autoTimestamp = new AutoTimestampExtension(this.settings);
    this.timeline = new TimelineExtension(this.settings);
    this.timelineLivePreview = new TimelineLivePreviewExtension(this.settings);

    // Markdown-first: all core UX lives in editor/preview extensions, no custom ItemView required.
    this.registerEditorExtension(this.buildEditorExtensions());
    registerTimelinePostProcessor(this);

    // External automation trigger file (vault-relative)
    registerOpenTrigger(this.app, { controlPath: "Temporal Drift/open.txt" });

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
