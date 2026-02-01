// ============================================================================
// Task Sidebar View - Now/Next/Later Priority View
// ============================================================================

import { App, ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { TemporalDriftSettings, SettingsAware, TaskMeta } from "../types";
import { TaskIndexService } from "../services/task-index";

export const VIEW_TYPE_TASK_SIDEBAR = "temporal-drift-task-sidebar";

export class TaskSidebarView extends ItemView implements SettingsAware {
  private settings: TemporalDriftSettings;
  private taskIndexService: TaskIndexService;
  private draggedItem: HTMLElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    app: App,
    settings: TemporalDriftSettings,
    taskIndexService: TaskIndexService
  ) {
    super(leaf);
    this.settings = settings;
    this.taskIndexService = taskIndexService;
  }

  getViewType(): string {
    return VIEW_TYPE_TASK_SIDEBAR;
  }

  getDisplayText(): string {
    return "Tasks";
  }

  getIcon(): string {
    return "check-square";
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.refresh();
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("temporal-drift-task-sidebar");

    await this.render();

    // Listen for task changes
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (file instanceof TFile && file.path.startsWith(this.settings.tasksFolder)) {
          await this.refresh();
        }
      })
    );
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  /**
   * Render the sidebar
   */
  async render(): Promise<void> {
    this.contentEl.empty();

    // Wait for task index if not ready
    if (!this.taskIndexService.isInitialized()) {
      const loading = this.contentEl.createDiv({ cls: "temporal-drift-loading" });
      loading.setText("Loading tasks...");
      return;
    }

    const tasks = this.taskIndexService.getOpenTasksByPriority();

    // Header
    const header = this.contentEl.createDiv({ cls: "temporal-drift-sidebar-header" });
    header.createEl("h3", { text: "Tasks" });

    const counts = this.taskIndexService.getCounts();
    const badge = header.createSpan({ cls: "temporal-drift-count-badge" });
    badge.setText(`${counts.open}`);

    // Priority sections
    this.renderSection("now", "Now", tasks.now || []);
    this.renderSection("next", "Next", tasks.next || []);
    this.renderSection("later", "Later", tasks.later || []);

    // Add task button
    const addBtn = this.contentEl.createEl("button", {
      cls: "temporal-drift-add-task-btn",
      text: "+ Add Task",
    });
    addBtn.addEventListener("click", () => this.promptNewTask());
  }

  /**
   * Render a priority section
   */
  private renderSection(priority: string, title: string, tasks: TaskMeta[]): void {
    const section = this.contentEl.createDiv({
      cls: "temporal-drift-task-section",
      attr: {
        "data-priority": priority,
      },
    });

    // Section header
    const sectionHeader = section.createDiv({ cls: "temporal-drift-section-header" });
    sectionHeader.createSpan({ text: title, cls: "temporal-drift-section-title" });
    sectionHeader.createSpan({
      text: `${tasks.length}`,
      cls: "temporal-drift-section-count",
    });

    // Task list container (drop zone)
    const taskList = section.createDiv({
      cls: "temporal-drift-task-list",
      attr: {
        "data-priority": priority,
      },
    });

    // Setup drop zone
    this.setupDropZone(taskList, priority);

    // Render tasks
    if (tasks.length === 0) {
      const empty = taskList.createDiv({ cls: "temporal-drift-empty-section" });
      empty.setText("No tasks");
    } else {
      for (const task of tasks) {
        this.renderTaskItem(taskList, task);
      }
    }
  }

  /**
   * Render a single task item
   */
  private renderTaskItem(container: HTMLElement, task: TaskMeta): void {
    const item = container.createDiv({
      cls: "temporal-drift-task-item",
      attr: {
        draggable: "true",
        "data-path": task.path,
      },
    });

    // Checkbox
    const checkbox = item.createEl("input", {
      cls: "temporal-drift-task-checkbox",
      attr: { type: "checkbox" },
    });
    (checkbox as HTMLInputElement).checked = task.status === "done";
    checkbox.addEventListener("change", async () => {
      const newStatus = (checkbox as HTMLInputElement).checked ? "done" : "open";
      await this.taskIndexService.toggleStatus(task.path, newStatus);
      await this.refresh();
    });

    // Title
    const title = item.createSpan({ cls: "temporal-drift-task-title" });
    title.setText(task.title);
    title.addEventListener("click", async () => {
      const file = this.app.vault.getAbstractFileByPath(task.path);
      if (file instanceof TFile) {
        await this.app.workspace.getLeaf(false).openFile(file);
      }
    });

    // Due date
    if (task.due) {
      const due = item.createSpan({ cls: "temporal-drift-task-due" });
      due.setText(task.due);
    }

    // Setup drag
    this.setupDragItem(item, task);
  }

  /**
   * Setup drag behavior on item
   */
  private setupDragItem(item: HTMLElement, task: TaskMeta): void {
    item.addEventListener("dragstart", (e) => {
      this.draggedItem = item;
      item.classList.add("dragging");
      e.dataTransfer?.setData("text/plain", task.path);
    });

    item.addEventListener("dragend", () => {
      item.classList.remove("dragging");
      this.draggedItem = null;
      // Remove all placeholders
      this.contentEl.querySelectorAll(".temporal-drift-drop-placeholder").forEach((el) => el.remove());
    });
  }

  /**
   * Setup drop zone behavior
   */
  private setupDropZone(container: HTMLElement, priority: string): void {
    container.addEventListener("dragover", (e) => {
      e.preventDefault();
      container.classList.add("drag-over");

      // Show placeholder
      const placeholder = container.querySelector(".temporal-drift-drop-placeholder");
      if (!placeholder) {
        const ph = container.createDiv({ cls: "temporal-drift-drop-placeholder" });
        ph.setText("Drop here");
      }
    });

    container.addEventListener("dragleave", () => {
      container.classList.remove("drag-over");
      container.querySelector(".temporal-drift-drop-placeholder")?.remove();
    });

    container.addEventListener("drop", async (e) => {
      e.preventDefault();
      container.classList.remove("drag-over");
      container.querySelector(".temporal-drift-drop-placeholder")?.remove();

      const path = e.dataTransfer?.getData("text/plain");
      if (path) {
        await this.taskIndexService.updatePriority(path, priority as "now" | "next" | "later");
        await this.refresh();
      }
    });
  }

  /**
   * Prompt for new task
   */
  private async promptNewTask(): Promise<void> {
    const title = prompt("Task name:");
    if (title) {
      await this.taskIndexService.createTask(title);
      await this.refresh();
    }
  }

  /**
   * Refresh the view
   */
  async refresh(): Promise<void> {
    await this.render();
  }
}
