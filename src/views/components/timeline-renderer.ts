// ============================================================================
// Timeline Renderer Component
// ============================================================================

import { App, TFile, normalizePath } from "obsidian";
import { TimeEntry, ParsedDay, TemporalDriftSettings } from "../../types";
import { formatTime, formatDate } from "../../utils/time";

export interface TimelineRendererOptions {
  onEntryClick?: (entry: TimeEntry, index: number) => void;
  onEntryEdit?: (entry: TimeEntry, index: number, newContent: string) => void;
}

export class TimelineRenderer {
  private app: App;
  private containerEl: HTMLElement;
  private settings: TemporalDriftSettings;
  private options: TimelineRendererOptions;
  private currentData: ParsedDay | null = null;

  constructor(
    app: App,
    containerEl: HTMLElement,
    settings: TemporalDriftSettings,
    options: TimelineRendererOptions = {}
  ) {
    this.app = app;
    this.containerEl = containerEl;
    this.settings = settings;
    this.options = options;
  }

  /**
   * Update settings
   */
  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
  }

  /**
   * Parse a daily note into structured data
   */
  async parseDay(date: string): Promise<ParsedDay> {
    const path = normalizePath(`${this.settings.dailyNotesFolder}/${date}.md`);
    const file = this.app.vault.getAbstractFileByPath(path);

    const parsed: ParsedDay = {
      date,
      path,
      mtime: 0,
      entries: [],
    };

    if (!(file instanceof TFile)) {
      return parsed;
    }

    parsed.mtime = file.stat.mtime;

    let content: string;
    try {
      content = await this.app.vault.read(file);
    } catch (e) {
      console.warn("Temporal Drift: Failed to read daily note", path, e);
      return parsed;
    }
    const lines = content.split("\n");

    let inThankful = false;
    let inFocus = false;
    let thankfulLines: string[] = [];
    let focusLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Check for section headers
      if (line.match(/^##\s*Thankful/i)) {
        inThankful = true;
        inFocus = false;
        continue;
      }
      if (line.match(/^##\s*Focus/i)) {
        inThankful = false;
        inFocus = true;
        continue;
      }
      if (line.match(/^##/)) {
        inThankful = false;
        inFocus = false;
        continue;
      }

      // Collect thankful/focus content
      if (inThankful && line.trim()) {
        thankfulLines.push(line.trim());
        continue;
      }
      if (inFocus && line.trim()) {
        focusLines.push(line.trim());
        continue;
      }

      // Parse time entries - no regex lookbehind for iOS compatibility
      const timeMatch = line.match(/^(\d{2}):(\d{2})\s+(.*)$/);
      if (timeMatch) {
        const time = `${timeMatch[1]}:${timeMatch[2]}`;
        const content = timeMatch[3];

        // Detect task pattern: - [ ] [[Task name]]
        const taskMatch = content.match(/^-\s*\[\s*([xX ]?)\s*\]\s*\[\[([^\]]+)\]\]/);
        if (taskMatch) {
          parsed.entries.push({
            type: "task",
            time,
            content: taskMatch[2],
            status: taskMatch[1].toLowerCase() === "x" ? "done" : "open",
          });
          continue;
        }

        // Detect event pattern: [[Event ~id]] with [[Person]]
        const eventMatch = content.match(/^\[\[([^~\]]+)\s*~([^\]]+)\]\]/);
        if (eventMatch) {
          parsed.entries.push({
            type: "event",
            time,
            title: eventMatch[1].trim(),
            eventId: eventMatch[2].trim(),
          });
          continue;
        }

        // Regular note entry
        parsed.entries.push({
          type: "note",
          time,
          content,
        });
      }
    }

    if (thankfulLines.length > 0) {
      parsed.thankful = thankfulLines.join("\n");
    }
    if (focusLines.length > 0) {
      parsed.focus = focusLines.join("\n");
    }

    return parsed;
  }

  /**
   * Render the timeline
   */
  async render(date: string): Promise<void> {
    this.containerEl.empty();
    this.containerEl.addClass("temporal-drift-timeline");

    const parsed = await this.parseDay(date);
    this.currentData = parsed;

    // Header sections (Thankful, Focus)
    if (this.settings.showThankful && parsed.thankful) {
      this.renderSection("Thankful for", parsed.thankful);
    }

    if (this.settings.showFocus && parsed.focus) {
      this.renderSection("Focus", parsed.focus);
    }

    // Divider
    if ((parsed.thankful || parsed.focus) && parsed.entries.length > 0) {
      this.containerEl.createDiv({ cls: "temporal-drift-divider" });
    }

    // Timeline entries
    const entriesContainer = this.containerEl.createDiv({
      cls: "temporal-drift-entries",
      attr: {
        role: "listbox",
        "aria-label": "Timeline entries",
      },
    });

    if (parsed.entries.length === 0) {
      const emptyMsg = entriesContainer.createDiv({ cls: "temporal-drift-empty" });
      emptyMsg.setText("No entries yet. Press Enter to add one.");
    } else {
      const now = new Date();
      const currentTime = formatTime(now);
      const isToday = date === formatDate(now);

      parsed.entries.forEach((entry, index) => {
        this.renderEntry(entriesContainer, entry, index, isToday && entry.time === currentTime);
      });
    }
  }

  /**
   * Render a section (Thankful, Focus)
   */
  private renderSection(title: string, content: string): void {
    const section = this.containerEl.createDiv({ cls: "temporal-drift-section" });

    const header = section.createDiv({ cls: "temporal-drift-section-header" });
    header.setText(title.toUpperCase());

    const body = section.createDiv({ cls: "temporal-drift-section-body" });
    body.setText(content);
  }

  /**
   * Render a single timeline entry
   */
  private renderEntry(
    container: HTMLElement,
    entry: TimeEntry,
    index: number,
    isCurrent: boolean
  ): void {
    const entryEl = container.createDiv({
      cls: `temporal-drift-entry ${isCurrent ? "is-current" : ""} temporal-drift-entry-${entry.type}`,
      attr: {
        role: "option",
        tabindex: index === 0 ? "0" : "-1",
        "data-index": index.toString(),
      },
    });

    // Time column
    const timeEl = entryEl.createDiv({ cls: "temporal-drift-time" });
    timeEl.setText(entry.time);

    // Content column
    const contentEl = entryEl.createDiv({ cls: "temporal-drift-content" });

    switch (entry.type) {
      case "task":
        this.renderTaskEntry(contentEl, entry);
        break;
      case "event":
        this.renderEventEntry(contentEl, entry);
        break;
      case "note":
        contentEl.setText(entry.content);
        break;
    }

    // Click handler
    entryEl.addEventListener("click", () => {
      this.options.onEntryClick?.(entry, index);
    });

    // Keyboard navigation
    entryEl.addEventListener("keydown", (e) => {
      const entries = container.querySelectorAll(".temporal-drift-entry");

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = entries[index + 1] as HTMLElement;
        if (next) {
          entryEl.setAttribute("tabindex", "-1");
          next.setAttribute("tabindex", "0");
          next.focus();
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = entries[index - 1] as HTMLElement;
        if (prev) {
          entryEl.setAttribute("tabindex", "-1");
          prev.setAttribute("tabindex", "0");
          prev.focus();
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        this.options.onEntryClick?.(entry, index);
      }
    });
  }

  /**
   * Render a task entry
   */
  private renderTaskEntry(
    container: HTMLElement,
    entry: Extract<TimeEntry, { type: "task" }>
  ): void {
    const checkbox = container.createEl("input", {
      cls: "temporal-drift-checkbox",
      attr: {
        type: "checkbox",
      },
    });
    (checkbox as HTMLInputElement).checked = entry.status === "done";

    const title = container.createSpan({ cls: "temporal-drift-task-title" });
    title.setText(entry.content);

    if (entry.status === "done") {
      container.addClass("is-done");
    }
  }

  /**
   * Render an event entry
   */
  private renderEventEntry(
    container: HTMLElement,
    entry: Extract<TimeEntry, { type: "event" }>
  ): void {
    const link = container.createEl("a", {
      cls: "temporal-drift-event-link",
      attr: {
        href: "#",
      },
    });
    link.setText(entry.title);

    if (entry.participants && entry.participants.length > 0) {
      const participants = container.createSpan({ cls: "temporal-drift-participants" });
      participants.setText(` with ${entry.participants.join(", ")}`);
    }
  }

  /**
   * Get current parsed data
   */
  getCurrentData(): ParsedDay | null {
    return this.currentData;
  }

  /**
   * Cleanup when component is destroyed
   */
  destroy(): void {
    this.containerEl.empty();
    this.currentData = null;
  }
}
