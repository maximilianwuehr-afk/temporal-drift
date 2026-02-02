// ============================================================================
// Daily Note Service
// ============================================================================

import { App, TFile, normalizePath } from "obsidian";
import { TemporalDriftSettings, SettingsAware } from "../types";
import { formatDate, formatTime } from "../utils/time";

interface MigratedContent {
  thankful?: string;
  focus?: string;
  entries: string[];
}

export class DailyNoteService implements SettingsAware {
  private app: App;
  private settings: TemporalDriftSettings;

  constructor(app: App, settings: TemporalDriftSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
  }

  /**
   * Get the path for a daily note
   */
  getDailyNotePath(date: string): string {
    return normalizePath(`${this.settings.dailyNotesFolder}/${date}.md`);
  }

  /**
   * Check if a daily note exists
   */
  dailyNoteExists(date: string): boolean {
    const path = this.getDailyNotePath(date);
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile;
  }

  /**
   * Get the daily note file for a date
   */
  getDailyNoteFile(date: string): TFile | null {
    const path = this.getDailyNotePath(date);
    const file = this.app.vault.getAbstractFileByPath(path);
    return file instanceof TFile ? file : null;
  }

  /**
   * Get the template for a new daily note
   */
  private getTemplate(date: string, migratedContent?: MigratedContent): string {
    const lines: string[] = [`# ${date}`, ""];

    if (this.settings.showThankful) {
      lines.push("## Thankful for", "");
      if (migratedContent?.thankful) {
        lines.push(migratedContent.thankful);
      }
      lines.push("");
    }

    if (this.settings.showFocus) {
      lines.push("## Focus", "");
      if (migratedContent?.focus) {
        lines.push(migratedContent.focus);
      }
      lines.push("");
    }

    // Add migrated entries or current time
    if (migratedContent?.entries && migratedContent.entries.length > 0) {
      lines.push(...migratedContent.entries);
    } else {
      const time = formatTime(new Date());
      lines.push(`${time} `);
    }

    return lines.join("\n");
  }

  /**
   * Check if content has proper Temporal Drift formatting
   */
  private hasProperFormatting(content: string): boolean {
    // Must have a date header
    if (!content.match(/^# \d{4}-\d{2}-\d{2}/m)) {
      return false;
    }

    // Should have at least one of the expected sections or time entries
    const hasThankful = content.match(/^## (Thankful|Grateful)/im);
    const hasFocus = content.match(/^## Focus/im);
    const hasTimeEntry = content.match(/^\d{2}:\d{2}\s/m);

    return !!(hasThankful || hasFocus || hasTimeEntry);
  }

  /**
   * Extract content from an improperly formatted note
   */
  private extractContent(content: string): MigratedContent {
    const migrated: MigratedContent = {
      entries: [],
    };

    const lines = content.split("\n");
    let currentSection: "none" | "thankful" | "focus" | "entries" = "none";
    const thankfulLines: string[] = [];
    const focusLines: string[] = [];

    for (const line of lines) {
      // Skip the main title
      if (line.match(/^# /)) continue;

      // Detect sections
      if (line.match(/^## (Thankful|Grateful)/i)) {
        currentSection = "thankful";
        continue;
      }
      if (line.match(/^## Focus/i)) {
        currentSection = "focus";
        continue;
      }
      if (line.match(/^## /)) {
        currentSection = "none";
        continue;
      }

      // Time entries
      if (line.match(/^\d{2}:\d{2}\s/)) {
        migrated.entries.push(line);
        currentSection = "entries";
        continue;
      }

      // Collect section content
      if (currentSection === "thankful" && line.trim()) {
        thankfulLines.push(line);
      } else if (currentSection === "focus" && line.trim()) {
        focusLines.push(line);
      } else if (currentSection === "entries" && line.trim()) {
        // Continuation of previous entry
        migrated.entries.push(line);
      } else if (currentSection === "none" && line.trim()) {
        // Unstructured content - add as entry without timestamp
        migrated.entries.push(line);
      }
    }

    if (thankfulLines.length > 0) {
      migrated.thankful = thankfulLines.join("\n");
    }
    if (focusLines.length > 0) {
      migrated.focus = focusLines.join("\n");
    }

    return migrated;
  }

  /**
   * Create a daily note if it doesn't exist, or migrate if improperly formatted
   */
  async createDailyNote(date: string): Promise<TFile> {
    const path = this.getDailyNotePath(date);

    // Check if file exists
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      // Check if it has proper formatting
      const content = await this.app.vault.read(existing);
      if (this.hasProperFormatting(content)) {
        return existing;
      }

      // Archive the old note and create new one
      const backupPath = normalizePath(
        `${this.settings.dailyNotesFolder}/${date}_backup.md`
      );

      // Extract content before archiving
      const migratedContent = this.extractContent(content);

      // Rename to backup
      await this.app.fileManager.renameFile(existing, backupPath);

      // Create new note with migrated content
      const newContent = this.getTemplate(date, migratedContent);
      return await this.app.vault.create(path, newContent);
    }

    // Ensure folder exists
    const folderPath = this.settings.dailyNotesFolder;
    const folder = this.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      await this.app.vault.createFolder(folderPath);
    }

    // Create the note
    const content = this.getTemplate(date);
    return await this.app.vault.create(path, content);
  }

  /**
   * Open today's daily note (create if needed)
   */
  async openToday(): Promise<void> {
    const today = formatDate(new Date());
    const file = await this.createDailyNote(today);
    await this.openDailyNote(today);
  }

  /**
   * Open a daily note by date
   */
  async openDailyNote(date: string): Promise<void> {
    const file = await this.createDailyNote(date);
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file);
  }

  /**
   * Append an entry to a daily note
   */
  async appendEntry(date: string, time: string, text: string): Promise<void> {
    const file = await this.createDailyNote(date);

    await this.app.vault.process(file, (content) => {
      // Find a good place to insert (end of file or before next day heading)
      return content.trimEnd() + `\n\n${time} ${text}`;
    });
  }

  /**
   * Add an entry at the current time
   */
  async addCurrentEntry(text: string): Promise<void> {
    const today = formatDate(new Date());
    const time = formatTime(new Date());
    await this.appendEntry(today, time, text);
  }
}
