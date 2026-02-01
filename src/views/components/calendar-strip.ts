// ============================================================================
// Calendar Strip Component
// ============================================================================

import { addDays, isSameDay, formatDayLong, formatDate } from "../../utils/time";

export interface CalendarStripOptions {
  onDateSelect: (date: Date) => void;
  daysToShow?: number;
}

export class CalendarStrip {
  private containerEl: HTMLElement;
  private currentDate: Date;
  private selectedDate: Date;
  private options: CalendarStripOptions;
  private clickHandler: ((e: MouseEvent) => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(containerEl: HTMLElement, options: CalendarStripOptions) {
    this.containerEl = containerEl;
    this.currentDate = new Date();
    this.selectedDate = new Date();
    this.options = options;
  }

  /**
   * Render the calendar strip
   */
  render(selectedDate?: Date): void {
    if (selectedDate) {
      this.selectedDate = selectedDate;
    }

    // Remove old event listeners before re-rendering
    this.removeListeners();

    this.containerEl.empty();
    this.containerEl.addClass("temporal-drift-calendar-strip");
    this.containerEl.setAttribute("role", "listbox");
    this.containerEl.setAttribute("aria-label", "Week navigation");

    const daysToShow = this.options.daysToShow ?? 7;
    const halfDays = Math.floor(daysToShow / 2);

    // Navigation buttons
    const prevBtn = this.containerEl.createEl("button", {
      cls: "temporal-drift-nav-btn",
      attr: {
        "aria-label": "Previous week",
        "data-action": "prev-week",
      },
    });
    prevBtn.createSpan({ text: "←" });

    // Days container
    const daysContainer = this.containerEl.createDiv({
      cls: "temporal-drift-days",
    });

    for (let i = -halfDays; i <= halfDays; i++) {
      const date = addDays(this.selectedDate, i);
      const isToday = isSameDay(date, this.currentDate);
      const isSelected = isSameDay(date, this.selectedDate);

      const dayBtn = daysContainer.createEl("button", {
        cls: `temporal-drift-day ${isToday ? "is-today" : ""} ${isSelected ? "is-selected" : ""}`,
        attr: {
          "aria-label": formatDayLong(date),
          "aria-selected": isSelected ? "true" : "false",
          role: "option",
          tabindex: isSelected ? "0" : "-1",
          "data-date": formatDate(date),
        },
      });

      // Day name (short)
      const dayName = dayBtn.createDiv({ cls: "temporal-drift-day-name" });
      dayName.setText(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()]);

      // Day number
      const dayNum = dayBtn.createDiv({ cls: "temporal-drift-day-num" });
      dayNum.setText(date.getDate().toString());
    }

    // Next button
    const nextBtn = this.containerEl.createEl("button", {
      cls: "temporal-drift-nav-btn",
      attr: {
        "aria-label": "Next week",
        "data-action": "next-week",
      },
    });
    nextBtn.createSpan({ text: "→" });

    // Event delegation for clicks
    this.clickHandler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check for nav buttons
      const navBtn = target.closest("[data-action]") as HTMLElement;
      if (navBtn) {
        const action = navBtn.getAttribute("data-action");
        if (action === "prev-week") {
          this.navigateWeek(-1);
        } else if (action === "next-week") {
          this.navigateWeek(1);
        }
        return;
      }

      // Check for day buttons
      const dayBtn = target.closest(".temporal-drift-day") as HTMLElement;
      if (dayBtn) {
        const dateStr = dayBtn.getAttribute("data-date");
        if (dateStr) {
          this.selectedDate = new Date(dateStr);
          this.options.onDateSelect(this.selectedDate);
          this.render();
        }
      }
    };
    this.containerEl.addEventListener("click", this.clickHandler);

    // Event delegation for keyboard
    this.keyHandler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const dayBtn = target.closest(".temporal-drift-day") as HTMLElement;

      if (!dayBtn) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        this.focusDay(-1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        this.focusDay(1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const dateStr = dayBtn.getAttribute("data-date");
        if (dateStr) {
          this.selectedDate = new Date(dateStr);
          this.options.onDateSelect(this.selectedDate);
          this.render();
        }
      }
    };
    this.containerEl.addEventListener("keydown", this.keyHandler);
  }

  /**
   * Remove event listeners for cleanup
   */
  private removeListeners(): void {
    if (this.clickHandler) {
      this.containerEl.removeEventListener("click", this.clickHandler);
      this.clickHandler = null;
    }
    if (this.keyHandler) {
      this.containerEl.removeEventListener("keydown", this.keyHandler);
      this.keyHandler = null;
    }
  }

  /**
   * Cleanup when component is destroyed
   */
  destroy(): void {
    this.removeListeners();
  }

  /**
   * Navigate to previous/next week
   */
  private navigateWeek(direction: number): void {
    this.selectedDate = addDays(this.selectedDate, direction * 7);
    this.options.onDateSelect(this.selectedDate);
    this.render();
  }

  /**
   * Focus adjacent day
   */
  private focusDay(direction: number): void {
    const buttons = this.containerEl.querySelectorAll(".temporal-drift-day");
    const currentIndex = Array.from(buttons).findIndex(
      (btn) => btn.getAttribute("aria-selected") === "true"
    );

    const newIndex = currentIndex + direction;
    if (newIndex >= 0 && newIndex < buttons.length) {
      (buttons[newIndex] as HTMLElement).focus();
    }
  }

  /**
   * Set the selected date externally
   */
  setSelectedDate(date: Date): void {
    this.selectedDate = date;
    this.render();
  }

  /**
   * Get the currently selected date
   */
  getSelectedDate(): Date {
    return this.selectedDate;
  }
}
