// ============================================================================
// Temporal Drift View
// ============================================================================

import { App, ItemView, WorkspaceLeaf } from "obsidian";
import { TemporalDriftSettings, SettingsAware, TimeEntry } from "../types";
import { CalendarStrip } from "./components/calendar-strip";
import { TimelineRenderer } from "./components/timeline-renderer";
import { FloatingActionButton } from "./components/fab";
import { formatTime } from "../utils/time";
import { formatDate } from "../utils/time";
import { DailyNoteService } from "../services/daily-note";
import { CalendarService } from "../services/calendar";

export const VIEW_TYPE_TEMPORAL_DRIFT = "temporal-drift-view";

export class TemporalDriftView extends ItemView implements SettingsAware {
  private settings: TemporalDriftSettings;
  private dailyNoteService: DailyNoteService;
  private calendarService: CalendarService;
  private calendarStrip: CalendarStrip | null = null;
  private timelineRenderer: TimelineRenderer | null = null;
  private fab: FloatingActionButton | null = null;
  private selectedDate: Date = new Date();

  constructor(
    leaf: WorkspaceLeaf,
    app: App,
    settings: TemporalDriftSettings,
    dailyNoteService: DailyNoteService,
    calendarService: CalendarService
  ) {
    super(leaf);
    this.settings = settings;
    this.dailyNoteService = dailyNoteService;
    this.calendarService = calendarService;
  }

  getViewType(): string {
    return VIEW_TYPE_TEMPORAL_DRIFT;
  }

  getDisplayText(): string {
    return "Temporal Drift";
  }

  getIcon(): string {
    return "clock";
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.timelineRenderer?.updateSettings(settings);
    this.refresh();
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("temporal-drift-view");

    // Calendar strip container
    const calendarContainer = this.contentEl.createDiv({
      cls: "temporal-drift-calendar-container",
    });

    // Timeline container
    const timelineContainer = this.contentEl.createDiv({
      cls: "temporal-drift-timeline-container",
    });

    // Initialize calendar strip
    this.calendarStrip = new CalendarStrip(calendarContainer, {
      onDateSelect: (date) => this.onDateSelected(date),
      daysToShow: this.settings.calendarDays,
    });
    this.calendarStrip.render(this.selectedDate);

    // Initialize timeline renderer
    this.timelineRenderer = new TimelineRenderer(
      this.app,
      timelineContainer,
      this.settings,
      this.calendarService,
      {
        onEntryClick: (entry, index) => this.onEntryClicked(entry, index),
      }
    );

    // Render initial timeline
    await this.renderTimeline();

    // Initialize FAB for mobile
    this.fab = new FloatingActionButton(this.contentEl, {
      onClick: () => this.quickCapture(),
      icon: "+",
      label: "Quick capture",
    });
    this.fab.render();

    // Listen for file changes
    const handleFileChange = async () => {
      const currentDate = formatDate(this.selectedDate);
      const file = this.dailyNoteService.getDailyNoteFile(currentDate);
      if (file) {
        await this.renderTimeline();
      }
    };

    this.registerEvent(this.app.vault.on("modify", handleFileChange));
    this.registerEvent(this.app.vault.on("create", handleFileChange));
  }

  async onClose(): Promise<void> {
    // Cleanup components
    this.calendarStrip?.destroy();
    this.timelineRenderer?.destroy();
    this.fab?.destroy();
  }

  /**
   * Quick capture - add timestamped entry to today's note
   */
  private async quickCapture(): Promise<void> {
    const today = formatDate(new Date());
    const time = formatTime(new Date());

    // Append entry and open note
    await this.dailyNoteService.appendEntry(today, time, "");
    await this.dailyNoteService.openToday();
  }

  /**
   * Handle date selection from calendar strip
   */
  private async onDateSelected(date: Date): Promise<void> {
    this.selectedDate = date;
    await this.renderTimeline();
  }

  /**
   * Handle entry click
   */
  private async onEntryClicked(entry: TimeEntry, index: number): Promise<void> {
    // For now, just open the daily note
    const dateStr = formatDate(this.selectedDate);
    await this.dailyNoteService.openDailyNote(dateStr);
  }

  /**
   * Render the timeline for the selected date
   */
  private async renderTimeline(): Promise<void> {
    if (!this.timelineRenderer) return;

    const dateStr = formatDate(this.selectedDate);
    await this.timelineRenderer.render(dateStr);
  }

  /**
   * Refresh the view
   */
  async refresh(): Promise<void> {
    this.calendarStrip?.render(this.selectedDate);
    await this.renderTimeline();
  }

  /**
   * Navigate to today
   */
  async goToToday(): Promise<void> {
    this.selectedDate = new Date();
    this.calendarStrip?.setSelectedDate(this.selectedDate);
    await this.renderTimeline();
  }

  /**
   * Get the currently selected date
   */
  getSelectedDate(): Date {
    return this.selectedDate;
  }
}
