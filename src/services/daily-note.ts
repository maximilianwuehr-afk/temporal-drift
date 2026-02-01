// ============================================================================
// Daily Note Service
// ============================================================================

import { App, TFile, normalizePath } from "obsidian";
import { TemporalDriftSettings, SettingsAware } from "../types";
import { formatDate, formatTime } from "../utils/time";

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
  private getTemplate(date: string): string {
    const lines: string[] = [`# ${date}`, ""];

    if (this.settings.showThankful) {
      lines.push("## Thankful for", "", "");
    }

    if (this.settings.showFocus) {
      lines.push("## Focus", "", "");
    }

    // Add current time as first entry
    const time = formatTime(new Date());
    lines.push(`${time} `);

    return lines.join("\n");
  }

  /**
   * Create a daily note if it doesn't exist
   */
  async createDailyNote(date: string): Promise<TFile> {
    const path = this.getDailyNotePath(date);

    // Check if file exists
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      return existing;
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
