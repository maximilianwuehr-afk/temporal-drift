// ============================================================================
// OpenClaw / Denethor bridge
//
// Responsibilities:
// - Inbound: consume OpenClaw commands from NDJSON and execute local actions.
// - Outbound: append Denethor research jobs to an NDJSON queue.
// - Auto-trigger: on note create (daily / people / organizations), enqueue research.
// ============================================================================

import { Notice, TAbstractFile, TFile, normalizePath } from "obsidian";
import type TemporalDriftPlugin from "../main";
import { pathInFolder } from "../utils/folder-match";
import { formatDate, formatTime } from "../utils/time";

type DenethorNoteType = "daily" | "person" | "organization" | "note";

type OpenClawCommand =
  | {
      command_id?: string;
      action: "create_daily_note" | "create_temporal_drift_page";
      date?: string;
      open?: boolean;
      trigger_denethor?: boolean;
    }
  | {
      command_id?: string;
      action: "create_people_note";
      title?: string;
      path?: string;
      open?: boolean;
      trigger_denethor?: boolean;
    }
  | {
      command_id?: string;
      action: "create_org_note" | "create_organization_note";
      title?: string;
      path?: string;
      open?: boolean;
      trigger_denethor?: boolean;
    }
  | {
      command_id?: string;
      action: "append_timeline_entry";
      date?: string;
      time?: string;
      text?: string;
      open?: boolean;
    }
  | {
      command_id?: string;
      action: string;
      [key: string]: unknown;
    };

interface DenethorQueueEntry {
  job_id: string;
  kind: "research_note";
  note_path: string;
  note_type: DenethorNoteType;
  trigger: string;
  created_at: string;
}

export interface DenethorBridge {
  refresh(): Promise<void>;
  onFileCreate(file: TFile): Promise<void>;
  enqueueForFile(file: TFile, trigger: string, force?: boolean): Promise<boolean>;
}

class DenethorBridgeImpl implements DenethorBridge {
  private readonly plugin: TemporalDriftPlugin;
  private processedCommandKeys = new Set<string>();
  private queueWriteChain: Promise<void> = Promise.resolve();
  private commandReadChain: Promise<void> = Promise.resolve();

  constructor(plugin: TemporalDriftPlugin) {
    this.plugin = plugin;
  }

  register(): void {
    this.plugin.app.workspace.onLayoutReady(() => {
      void this.refresh();
    });

    this.plugin.registerEvent(
      this.plugin.app.vault.on("modify", (file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        if (!this.isAutomationEnabled()) return;
        if (normalizePath(file.path) !== this.getCommandsPath()) return;

        this.commandReadChain = this.commandReadChain
          .then(async () => this.consumeCommandFile(file))
          .catch((error) => {
            console.error("[Temporal Drift] OpenClaw command handling failed", error);
          });
      })
    );
  }

  async onFileCreate(file: TFile): Promise<void> {
    if (!this.isAutomationEnabled()) return;
    if (file.extension !== "md") return;

    const noteType = this.classifyAutoResearchType(file.path);
    if (!noteType) return;

    const shouldQueue =
      (noteType === "daily" && this.plugin.settings.denethorAutoResearchDailyNotes) ||
      (noteType === "person" && this.plugin.settings.denethorAutoResearchPeople) ||
      (noteType === "organization" && this.plugin.settings.denethorAutoResearchOrganizations);

    if (!shouldQueue) return;

    await this.enqueueForFile(file, `auto:${noteType}:create`);
  }

  async enqueueForFile(file: TFile, trigger: string, force = false): Promise<boolean> {
    if (!this.isAutomationEnabled()) return false;
    if (file.extension !== "md") return false;

    if (!force) {
      const existingStatus = this.getDenethorStatus(file);
      if (existingStatus === "running" || existingStatus === "done") {
        return false;
      }
    }

    const noteType = this.classifyNoteType(file.path);
    const entry: DenethorQueueEntry = {
      job_id: this.buildJobId(file.path),
      kind: "research_note",
      note_path: normalizePath(file.path),
      note_type: noteType,
      trigger,
      created_at: new Date().toISOString(),
    };

    await this.appendQueueEntry(entry);
    await this.markDenethorQueued(file, trigger);
    return true;
  }

  async refresh(): Promise<void> {
    await this.ensureAutomationFiles();
  }

  private isAutomationEnabled(): boolean {
    return !!this.plugin.settings.openClawAutomationEnabled;
  }

  private getCommandsPath(): string {
    return normalizePath(this.plugin.settings.openClawCommandsPath || "Temporal Drift/commands.ndjson");
  }

  private getQueuePath(): string {
    return normalizePath(this.plugin.settings.denethorQueuePath || "Temporal Drift/denethor-queue.ndjson");
  }

  private async ensureAutomationFiles(): Promise<void> {
    if (!this.isAutomationEnabled()) return;
    await this.ensureFileExists(this.getCommandsPath());
    await this.ensureFileExists(this.getQueuePath());
  }

  private async ensureFileExists(path: string): Promise<void> {
    const normalized = normalizePath(path);
    const existing = this.plugin.app.vault.getAbstractFileByPath(normalized);
    if (existing instanceof TFile) return;

    const parts = normalized.split("/");
    if (parts.length > 1) {
      const folder = parts.slice(0, -1).join("/");
      if (!this.plugin.app.vault.getAbstractFileByPath(folder)) {
        try {
          await this.plugin.app.vault.createFolder(folder);
        } catch {
          // ignore if another process created the folder first
        }
      }
    }

    try {
      await this.plugin.app.vault.create(normalized, "");
    } catch {
      // ignore if another process created the file first
    }
  }

  private async appendQueueEntry(entry: DenethorQueueEntry): Promise<void> {
    this.queueWriteChain = this.queueWriteChain.then(async () => {
      await this.ensureFileExists(this.getQueuePath());
      const file = this.plugin.app.vault.getAbstractFileByPath(this.getQueuePath());
      if (!(file instanceof TFile)) return;

      const line = JSON.stringify(entry);
      await this.plugin.app.vault.process(file, (content) => {
        const trimmed = content.trimEnd();
        return trimmed.length > 0 ? `${trimmed}\n${line}\n` : `${line}\n`;
      });
    });

    await this.queueWriteChain;
  }

  private getDenethorStatus(file: TFile): string | null {
    const cache = this.plugin.app.metadataCache.getFileCache(file);
    const frontmatter = cache?.frontmatter as Record<string, unknown> | undefined;
    if (!frontmatter) return null;

    const flatStatus = frontmatter.denethor_status;
    if (typeof flatStatus === "string" && flatStatus.trim().length > 0) {
      return flatStatus.toLowerCase();
    }

    // Backward compatibility for legacy object format.
    const denethor = frontmatter.denethor;
    if (denethor && typeof denethor === "object") {
      const status = (denethor as Record<string, unknown>).status;
      if (typeof status === "string") return status.toLowerCase();
    }

    return null;
  }

  private async markDenethorQueued(file: TFile, trigger: string): Promise<void> {
    try {
      await this.plugin.app.fileManager.processFrontMatter(file, (frontmatter) => {
        const root = frontmatter as Record<string, unknown>;
        root.denethor_status = "queued";
        root.denethor_last_enqueued_at = new Date().toISOString();
        root.denethor_last_trigger = trigger;

        // Migrate away from legacy object so Obsidian properties stay readable.
        delete root.denethor;
      });
    } catch {
      // Keep queue write successful even if frontmatter update fails.
    }
  }

  private async consumeCommandFile(file: TFile): Promise<void> {
    const content = await this.plugin.app.vault.read(file);
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i].trim();
      if (!raw || raw.startsWith("#")) continue;

      const parsed = this.parseCommand(raw);
      if (!parsed) {
        console.warn(`[Temporal Drift] Invalid OpenClaw command JSON at line ${i + 1}`);
        continue;
      }

      const key = this.getCommandKey(parsed, i, raw);
      if (this.processedCommandKeys.has(key)) continue;
      this.processedCommandKeys.add(key);

      await this.executeCommand(parsed);
    }
  }

  private parseCommand(raw: string): OpenClawCommand | null {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return null;
      const command = parsed as OpenClawCommand;
      if (typeof command.action !== "string" || command.action.trim().length === 0) return null;
      return command;
    } catch {
      return null;
    }
  }

  private getCommandKey(command: OpenClawCommand, lineIndex: number, rawLine: string): string {
    const id = typeof command.command_id === "string" ? command.command_id.trim() : "";
    if (id.length > 0) return `id:${id}`;
    return `line:${lineIndex}:${rawLine}`;
  }

  private async executeCommand(command: OpenClawCommand): Promise<void> {
    switch (command.action) {
      case "create_daily_note":
      case "create_temporal_drift_page":
        await this.handleCreateDailyNote(command);
        return;
      case "create_people_note":
        await this.handleCreateEntityNote(command, "person");
        return;
      case "create_org_note":
      case "create_organization_note":
        await this.handleCreateEntityNote(command, "organization");
        return;
      case "append_timeline_entry":
        await this.handleAppendTimelineEntry(command);
        return;
      default:
        console.warn(`[Temporal Drift] Unsupported OpenClaw action: ${command.action}`);
    }
  }

  private async handleCreateDailyNote(command: Extract<OpenClawCommand, { action: "create_daily_note" | "create_temporal_drift_page" }>): Promise<void> {
    const date = this.isIsoDate(command.date) ? command.date : formatDate(new Date());
    const file = await this.ensureDailyNote(date);

    if (command.open !== false) {
      const leaf = this.plugin.app.workspace.getLeaf(false);
      await leaf.openFile(file, { active: true });
    }

    if (command.trigger_denethor === true) {
      await this.enqueueForFile(file, "openclaw:create_daily_note", true);
    }
  }

  private async handleCreateEntityNote(
    command: Extract<
      OpenClawCommand,
      { action: "create_people_note" } | { action: "create_org_note" | "create_organization_note" }
    >,
    kind: "person" | "organization"
  ): Promise<void> {
    const folder = kind === "person" ? this.plugin.settings.peopleFolder : this.plugin.settings.organizationsFolder;
    const fallbackTitle = kind === "person" ? "New Person" : "New Organization";
    const title = (typeof command.title === "string" ? command.title.trim() : "") || fallbackTitle;

    const file = await this.ensureEntityNote(folder, title, typeof command.path === "string" ? command.path : "");

    if (command.open !== false) {
      const leaf = this.plugin.app.workspace.getLeaf(false);
      await leaf.openFile(file, { active: true });
    }

    if (command.trigger_denethor === true) {
      await this.enqueueForFile(file, `openclaw:create_${kind}_note`, true);
    }
  }

  private async handleAppendTimelineEntry(command: Extract<OpenClawCommand, { action: "append_timeline_entry" }>): Promise<void> {
    const date = this.isIsoDate(command.date) ? command.date : formatDate(new Date());
    const time = this.isIsoTime(command.time) ? command.time : formatTime(new Date());
    const text = typeof command.text === "string" ? command.text.trim() : "";
    if (!text) {
      new Notice("Temporal Drift: append_timeline_entry ignored (missing text)");
      return;
    }

    const file = await this.ensureDailyNote(date);
    await this.plugin.app.vault.process(file, (content) => {
      const trimmed = content.trimEnd();
      return `${trimmed}\n\n${time} ${text}\n`;
    });

    if (command.open === true) {
      const leaf = this.plugin.app.workspace.getLeaf(false);
      await leaf.openFile(file, { active: true });
    }
  }

  private async ensureDailyNote(date: string): Promise<TFile> {
    const folder = normalizePath(this.plugin.settings.dailyNotesFolder || "Daily notes");
    const path = normalizePath(`${folder}/${date}.md`);
    const existing = this.plugin.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;

    await this.ensureFolderExists(folder);

    const lines: string[] = [`# ${date}`, ""];
    if (this.plugin.settings.showThankful) {
      lines.push("## Thankful for", "", "");
    }
    if (this.plugin.settings.showFocus) {
      lines.push("## Focus", "", "");
    }
    lines.push(`${formatTime(new Date())} `);

    return this.plugin.app.vault.create(path, lines.join("\n"));
  }

  private async ensureEntityNote(folder: string, title: string, commandPath: string): Promise<TFile> {
    const folderPath = normalizePath(folder || "Notes");
    await this.ensureFolderExists(folderPath);

    const requestedPath = normalizePath(commandPath || "");
    const desiredPath =
      requestedPath.length > 0
        ? requestedPath.endsWith(".md")
          ? requestedPath
          : `${requestedPath}.md`
        : normalizePath(`${folderPath}/${this.sanitizeFileStem(title)}.md`);

    const existing = this.plugin.app.vault.getAbstractFileByPath(desiredPath);
    if (existing instanceof TFile) return existing;

    const content = `# ${title}\n`;
    return this.plugin.app.vault.create(desiredPath, content);
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    if (this.plugin.app.vault.getAbstractFileByPath(folderPath)) return;
    await this.plugin.app.vault.createFolder(folderPath);
  }

  private sanitizeFileStem(value: string): string {
    const collapsed = value.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
    return collapsed || "Untitled";
  }

  private classifyAutoResearchType(path: string): DenethorNoteType | null {
    const normalized = normalizePath(path);
    const basename = normalized.split("/").pop()?.replace(/\.md$/i, "") ?? "";

    if (
      pathInFolder(normalized, this.plugin.settings.dailyNotesFolder, ["Daily notes"]) &&
      /^\d{4}-\d{2}-\d{2}$/.test(basename)
    ) {
      return "daily";
    }

    if (pathInFolder(normalized, this.plugin.settings.peopleFolder, ["People"])) {
      return "person";
    }

    if (pathInFolder(normalized, this.plugin.settings.organizationsFolder, ["Organizations"])) {
      return "organization";
    }

    return null;
  }

  private classifyNoteType(path: string): DenethorNoteType {
    return this.classifyAutoResearchType(path) ?? "note";
  }

  private buildJobId(path: string): string {
    const normalized = normalizePath(path).replace(/[^\w./-]+/g, "_");
    return `denethor-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${normalized}`;
  }

  private isIsoDate(value: unknown): value is string {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  }

  private isIsoTime(value: unknown): value is string {
    return typeof value === "string" && /^\d{2}:\d{2}$/.test(value.trim());
  }
}

export function registerDenethorBridge(plugin: TemporalDriftPlugin): DenethorBridge {
  const bridge = new DenethorBridgeImpl(plugin);
  bridge.register();
  return bridge;
}
