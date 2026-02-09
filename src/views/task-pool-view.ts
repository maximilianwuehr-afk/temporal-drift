import { ItemView, TFile, WorkspaceLeaf, normalizePath } from "obsidian";
import type TemporalDriftPlugin from "../main";

export const VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL = "temporal-drift-task-pool";
const TD_TASK_MIME = "application/x-temporal-drift-task";

type TaskPriority = "now" | "next" | "later" | null;

type TaskPoolItem = {
  file: TFile;
  done: boolean;
  priority: TaskPriority;
};

function parsePriority(raw: unknown): TaskPriority {
  if (typeof raw !== "string") return null;
  const value = raw.trim().toLowerCase();
  if (value === "now" || value === "next" || value === "later") return value;
  return null;
}

function inferDoneFromText(content: string): boolean {
  const checkbox = content.match(/^-?\s*\[\s*([xX ])\s*\]/m);
  if (!checkbox) return false;
  return checkbox[1].toLowerCase() === "x";
}

export class TemporalDriftTaskPoolView extends ItemView {
  private plugin: TemporalDriftPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: TemporalDriftPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TEMPORAL_DRIFT_TASK_POOL;
  }

  getDisplayText(): string {
    return "Task Pool";
  }

  getIcon(): string {
    return "check-square";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("td-task-pool");

    await this.render();

    this.registerEvent(this.app.vault.on("create", async () => this.render()));
    this.registerEvent(this.app.vault.on("modify", async () => this.render()));
    this.registerEvent(this.app.vault.on("delete", async () => this.render()));
    this.registerEvent(this.app.vault.on("rename", async () => this.render()));
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private async listTasks(): Promise<TaskPoolItem[]> {
    const prefix = normalizePath(this.plugin.settings.tasksFolder + "/");
    const taskFiles = this.app.vault
      .getMarkdownFiles()
      .filter((f) => normalizePath(f.path).startsWith(prefix))
      .sort((a, b) => a.basename.localeCompare(b.basename));

    const items = await Promise.all(
      taskFiles.map(async (file): Promise<TaskPoolItem> => {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = cache?.frontmatter as Record<string, unknown> | undefined;

        let done = false;
        let priority: TaskPriority = null;

        if (fm) {
          const status = typeof fm.status === "string" ? fm.status.toLowerCase() : "";
          const doneFlag = typeof fm.done === "boolean" ? fm.done : false;
          done = doneFlag || status === "done" || status === "closed";
          priority = parsePriority(fm.priority);
        }

        if (!fm || (!done && !priority)) {
          try {
            const content = await this.app.vault.read(file);
            if (!done) done = inferDoneFromText(content);
            if (!priority) {
              const m = content.match(/(?:^|\s)(?:#|@)(now|next|later)(?:\s|$)/i);
              if (m) priority = parsePriority(m[1]);
            }
          } catch {
            // ignore read failures for a single task file
          }
        }

        return { file, done, priority };
      })
    );

    return items;
  }

  private createTaskRow(container: HTMLElement, task: TaskPoolItem): void {
    const row = container.createDiv({ cls: "td-task-row" });
    row.setAttribute("draggable", "true");
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Task ${task.file.basename}`);

    const check = row.createEl("input", {
      cls: "td-task-row-checkbox",
      attr: { type: "checkbox", disabled: "true" },
    }) as HTMLInputElement;
    check.checked = task.done;

    const title = row.createDiv({ cls: "td-task-row-title", text: task.file.basename });
    if (task.done) title.addClass("is-done");

    if (task.priority) {
      row.createDiv({ cls: `td-task-row-priority td-task-row-priority-${task.priority}`, text: task.priority });
    }

    row.addEventListener("dragstart", (e: DragEvent) => {
      if (!e.dataTransfer) return;
      const payload = {
        path: task.file.path,
        title: task.file.basename,
        priority: task.priority,
        done: task.done,
      };

      e.dataTransfer.effectAllowed = "copy";
      e.dataTransfer.setData(TD_TASK_MIME, JSON.stringify(payload));
      e.dataTransfer.setData("text/plain", `[[${task.file.path}|${task.file.basename}]]`);
      row.addClass("is-dragging");
    });

    row.addEventListener("dragend", () => {
      row.removeClass("is-dragging");
    });

    row.addEventListener("click", async () => {
      const leaf = this.app.workspace.getLeaf(false);
      await leaf.openFile(task.file, { active: true });
    });
  }

  private async render(): Promise<void> {
    this.contentEl.empty();

    const header = this.contentEl.createDiv({ cls: "td-task-pool-header" });
    header.createDiv({ cls: "td-task-pool-title", text: "Task Pool" });
    header.createDiv({
      cls: "td-task-pool-subtitle",
      text: "Drag a task into a daily note to allocate it to a time slot.",
    });

    const tasks = await this.listTasks();

    const open = tasks.filter((t) => !t.done);
    const done = tasks.filter((t) => t.done);

    const openSection = this.contentEl.createDiv({ cls: "td-task-pool-section" });
    openSection.createDiv({ cls: "td-task-pool-section-title", text: `Open (${open.length})` });
    const openList = openSection.createDiv({ cls: "td-task-pool-list" });

    if (open.length === 0) {
      openList.createDiv({ cls: "td-task-pool-empty", text: "No open tasks in Tasks/." });
    } else {
      open.forEach((task) => this.createTaskRow(openList, task));
    }

    const doneSection = this.contentEl.createDiv({ cls: "td-task-pool-section" });
    doneSection.createDiv({ cls: "td-task-pool-section-title", text: `Done (${done.length})` });
    const doneList = doneSection.createDiv({ cls: "td-task-pool-list" });

    if (done.length === 0) {
      doneList.createDiv({ cls: "td-task-pool-empty", text: "No done tasks." });
    } else {
      done.forEach((task) => this.createTaskRow(doneList, task));
    }
  }
}

export { TD_TASK_MIME };
