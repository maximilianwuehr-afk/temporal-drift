// ============================================================================
// Floating Action Button Component
// ============================================================================

export interface FABOptions {
  onClick: () => void;
  icon?: string;
  label?: string;
}

export class FloatingActionButton {
  private containerEl: HTMLElement;
  private options: FABOptions;
  private fabEl: HTMLElement | null = null;

  constructor(containerEl: HTMLElement, options: FABOptions) {
    this.containerEl = containerEl;
    this.options = options;
  }

  /**
   * Render the FAB
   */
  render(): void {
    this.fabEl = this.containerEl.createEl("button", {
      cls: "temporal-drift-fab",
      attr: {
        "aria-label": this.options.label || "Quick capture",
      },
    });

    // Icon
    const icon = this.fabEl.createSpan({ cls: "temporal-drift-fab-icon" });
    icon.setText(this.options.icon || "+");

    // Click handler
    this.fabEl.addEventListener("click", (e) => {
      e.stopPropagation();
      this.options.onClick();
    });

    // Touch feedback
    this.fabEl.addEventListener("touchstart", () => {
      this.fabEl?.classList.add("is-pressed");
    });
    this.fabEl.addEventListener("touchend", () => {
      this.fabEl?.classList.remove("is-pressed");
    });
  }

  /**
   * Show/hide the FAB
   */
  setVisible(visible: boolean): void {
    if (this.fabEl) {
      this.fabEl.style.display = visible ? "flex" : "none";
    }
  }

  /**
   * Destroy the FAB
   */
  destroy(): void {
    this.fabEl?.remove();
    this.fabEl = null;
  }
}
