import { App, TFile } from "obsidian";
import { TemporalDriftSettings } from "../types";
import {
  TaskSnapshot,
  applyTaskSnapshotToTimelineLine,
  parseTaskSnapshotFromContent,
} from "./task-allocation-utils";
import { pathInFolder } from "../utils/folder-match";

export class TaskAllocationSync {
  private app: App;
  private settings: TemporalDriftSettings;

  constructor(app: App, settings: TemporalDriftSettings) {
    this.app = app;
    this.settings = settings;
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
  }

  async syncFromTaskFile(file: TFile): Promise<void> {
    if (file.extension !== "md") return;

    if (!pathInFolder(file.path, this.settings.tasksFolder, ["Tasks"])) return;

    const content = await this.app.vault.read(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    const snapshot = parseTaskSnapshotFromContent(content, frontmatter);

    await this.syncAllocations(file.path, snapshot);
  }

  private async syncAllocations(taskPath: string, snapshot: TaskSnapshot): Promise<void> {
    const files = this.app.vault
      .getMarkdownFiles()
      .filter((f) => pathInFolder(f.path, this.settings.dailyNotesFolder, ["Daily notes"]));

    for (const file of files) {
      await this.app.vault.process(file, (content) => {
        const lines = content.split("\n");
        let changed = false;

        const nextLines = lines.map((line) => {
          const nextLine = applyTaskSnapshotToTimelineLine(line, taskPath, snapshot);
          if (nextLine !== line) changed = true;
          return nextLine;
        });

        return changed ? nextLines.join("\n") : content;
      });
    }
  }
}
