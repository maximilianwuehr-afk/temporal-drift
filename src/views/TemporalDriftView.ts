// ============================================================================
// Temporal Drift View (prototype-driven)
//
// Custom ItemView that renders a rich timeline UI (hour rows + vertical line)
// while keeping markdown as the source of truth.
// ============================================================================

import { ItemView, TFile, WorkspaceLeaf, MarkdownView, normalizePath } from "obsidian";
import type TemporalDriftPlugin from "../main";
import { formatDate } from "../utils/time";

export const VIEW_TYPE_TEMPORAL_DRIFT = "temporal-drift-view";

type EntryType = "event" | "task" | "note";

interface TimelineEntry {
  type: EntryType;
  time: string; // HH:mm
  head: string; // content on the time line
  body: string[]; // following indented lines (without leading indentation)
  lineNo: number; // 0-based index in file
}

function isDailyNotePath(path: string, dailyNotesFolder: string): boolean {
  const prefix = normalizePath(dailyNotesFolder + "/");
  return normalizePath(path).startsWith(prefix);
}

function looksLikeDailyNoteFilename(path: string): boolean {
  // .../YYYY-MM-DD.md
  return /\d{4}-\d{2}-\d{2}\.md$/i.test(path);
}

function getInitials(name: string): string {
  const cleaned = name.replace(/\[\[|\]\]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function parseWikilinkDisplay(raw: string): { target: string; display: string } {
  // raw: "Foo|Bar" or "Foo"
  const [target, display] = raw.split("|");
  return { target: (target ?? raw).trim(), display: (display ?? target ?? raw).trim() };
}

function extractParticipants(head: string): Array<{ target: string; display: string }> {
  // Example: "[[Standup ~id]] with [[Anna Meyer]], [[Tom Schmidt]]"
  const withIdx = head.indexOf(" with ");
  if (withIdx < 0) return [];

  const tail = head.slice(withIdx + " with ".length);
  const matches = Array.from(tail.matchAll(/\[\[([^\]]+)\]\]/g));
  return matches.map((m) => parseWikilinkDisplay(m[1]));
}

function extractPrimaryLink(head: string): { target: string; display: string } | null {
  const m = head.match(/\[\[([^\]]+)\]\]/);
  if (!m) return null;
  return parseWikilinkDisplay(m[1]);
}

function parseDailyNote(content: string): { thankful?: string; focus?: string; entries: TimelineEntry[] } {
  const lines = content.split("\n");
  const entries: TimelineEntry[] = [];

  let inThankful = false;
  let inFocus = false;
  const thankfulLines: string[] = [];
  const focusLines: string[] = [];

  const isTimeLine = (line: string) => /^\d{2}:\d{2}\b/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^##\s*(Thankful|Grateful)/i)) {
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

    if (inThankful) {
      if (line.trim()) thankfulLines.push(line.trim());
      continue;
    }
    if (inFocus) {
      if (line.trim()) focusLines.push(line.trim());
      continue;
    }

    const timeMatch = line.match(/^(\d{2}):(\d{2})\s*(.*)$/);
    if (!timeMatch) continue;

    const time = `${timeMatch[1]}:${timeMatch[2]}`;
    const head = (timeMatch[3] ?? "").trim();

    const body: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (isTimeLine(next)) break;
      // Stop at next top-level heading to avoid eating sections below.
      if (next.match(/^##/)) break;

      // Accept indented continuation lines. We store trimmed-left content.
      if (next.trim() === "") {
        // keep blank lines as separators
        body.push("");
      } else {
        body.push(next.replace(/^\s+/, ""));
      }

      j++;
    }

    // Determine entry type from head
    let type: EntryType = "note";
    if (head.match(/^\[\[[^\]]+\]\]/)) type = "event";
    if (head.match(/^-\s*\[\s*([xX ]?)\s*\]/)) type = "task";

    entries.push({ type, time, head, body, lineNo: i });
    i = j - 1;
  }

  return {
    thankful: thankfulLines.length ? thankfulLines.join("\n") : undefined,
    focus: focusLines.length ? focusLines.join("\n") : undefined,
    entries,
  };
}

function minutesSinceMidnight(hhmm: string): number {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return Number.NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export class TemporalDriftView extends ItemView {
  private plugin: TemporalDriftPlugin;
  private activeFile: TFile | null = null;
  private entries: TimelineEntry[] = [];
  private activeIndex: number = 0;

  constructor(leaf: WorkspaceLeaf, plugin: TemporalDriftPlugin) {
    super(leaf);
    this.plugin = plugin;
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

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("temporal-drift-view");
    this.contentEl.addClass("td-prototype");

    // Root structure (calendar area only, prototype-inspired)
    const calendar = this.contentEl.createDiv({ cls: "calendar" });

    const header = calendar.createDiv({ cls: "calendar-header" });
    header.createDiv({ cls: "label", text: "Today" });
    const dateEl = header.createDiv({ cls: "calendar-date" });

    const timeline = calendar.createDiv({ cls: "timeline" });

    // Keyboard nav (j/k) – ignore when typing in textarea
    this.registerDomEvent(document, "keydown", (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && ["TEXTAREA", "INPUT"].includes(target.tagName)) return;
      if (!this.contentEl.isConnected) return;

      if (e.key === "j") {
        e.preventDefault();
        this.setActiveIndex(Math.min(this.activeIndex + 1, Math.max(0, this.entries.length - 1)));
      }
      if (e.key === "k") {
        e.preventDefault();
        this.setActiveIndex(Math.max(this.activeIndex - 1, 0));
      }
    });

    const resolveFile = (): TFile | null => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      const f = activeView?.file ?? this.app.workspace.getActiveFile();
      if (f && isDailyNotePath(f.path, this.plugin.settings.dailyNotesFolder) && looksLikeDailyNoteFilename(f.path)) {
        return f;
      }
      // Fallback to today's daily note if it exists
      const today = formatDate(new Date());
      const path = normalizePath(`${this.plugin.settings.dailyNotesFolder}/${today}.md`);
      const maybe = this.app.vault.getAbstractFileByPath(path);
      return maybe instanceof TFile ? maybe : null;
    };

    const render = async () => {
      this.activeFile = resolveFile();

      const dateStr = this.activeFile ? this.activeFile.basename : formatDate(new Date());
      dateEl.setText(dateStr);

      timeline.empty();

      if (!this.activeFile) {
        const empty = timeline.createDiv({ cls: "empty" });
        empty.setText("No daily note found. Create one, then reopen Temporal Drift.");
        return;
      }

      const content = await this.app.vault.read(this.activeFile);
      const parsed = parseDailyNote(content);
      this.entries = parsed.entries;
      this.activeIndex = 0;

      // Find the "current" entry (closest time <= now, else next future)
      const now = new Date();
      const nowMins = now.getHours() * 60 + now.getMinutes();
      const entryMins = this.entries.map((e) => minutesSinceMidnight(e.time));

      let bestPastIdx: number | null = null;
      let bestPastDiff = Number.POSITIVE_INFINITY;
      let bestFutureIdx: number | null = null;
      let bestFutureDiff = Number.POSITIVE_INFINITY;

      for (let idx = 0; idx < entryMins.length; idx++) {
        const m = entryMins[idx];
        if (!Number.isFinite(m)) continue;
        const diff = m - nowMins;
        if (diff <= 0) {
          const abs = Math.abs(diff);
          if (abs < bestPastDiff) {
            bestPastDiff = abs;
            bestPastIdx = idx;
          }
        } else {
          if (diff < bestFutureDiff) {
            bestFutureDiff = diff;
            bestFutureIdx = idx;
          }
        }
      }

      const currentIdx = bestPastIdx ?? bestFutureIdx;

      if (this.entries.length === 0) {
        const row = timeline.createDiv({ cls: "hour" });
        row.createDiv({ cls: "hour-time", text: formatDate(new Date()) });
        row.createDiv({ cls: "hour-slot" }).createDiv({ cls: "empty", text: "+ add" });
        return;
      }

      this.entries.forEach((entry, idx) => {
        const row = timeline.createDiv({ cls: `hour${idx === currentIdx ? " now" : ""}` });
        row.createDiv({ cls: "hour-time", text: entry.time });
        const slot = row.createDiv({ cls: "hour-slot" });

        const card = slot.createDiv({ cls: `event${idx === 0 ? " active" : ""}` });
        card.setAttribute("tabindex", "0");
        card.dataset.index = String(idx);

        // Click selects and opens link (if present)
        card.addEventListener("click", async (ev) => {
          ev.preventDefault();
          this.setActiveIndex(idx);

          const link = extractPrimaryLink(entry.head);
          if (link) {
            await this.app.workspace.getLeaf(false).openLinkText(link.target, this.activeFile?.path ?? "");
          } else {
            // fallback: open daily note
            if (this.activeFile) {
              await this.app.workspace.getLeaf(false).openFile(this.activeFile);
            }
          }
        });

        const top = card.createDiv({ cls: "event-top" });
        const left = top.createDiv();

        // Title + location placeholder
        const titleText = (() => {
          const link = extractPrimaryLink(entry.head);
          if (link) return link.display;
          if (entry.type === "task") {
            const m = entry.head.match(/\[\[([^\]]+)\]\]/);
            if (m) return parseWikilinkDisplay(m[1]).display;
          }
          return entry.head || "(empty)";
        })();

        left.createDiv({ cls: "event-title", text: titleText });

        // For now: show the raw head as "location" line (prototype placeholder)
        if (entry.head) {
          left.createDiv({ cls: "event-location", text: entry.head });
        }

        const right = top.createDiv({ cls: "event-right" });
        right.createSpan({ cls: "event-duration", text: "" });

        // Participants chips (if we can parse them)
        const participants = extractParticipants(entry.head);
        if (participants.length > 0) {
          const pWrap = card.createDiv({ cls: "event-participants" });
          for (const p of participants) {
            const a = pWrap.createEl("a", { cls: "participant", attr: { href: "#" } });
            a.createSpan({ cls: "participant-avatar", text: getInitials(p.display) });
            a.appendText(p.display);
            a.addEventListener("click", async (e) => {
              e.preventDefault();
              e.stopPropagation();
              await this.app.workspace.getLeaf(false).openLinkText(p.target, this.activeFile?.path ?? "");
            });
          }
        }

        // Notes textarea (inline edit of the indented block)
        const notes = card.createDiv({ cls: "event-notes" });
        const textarea = notes.createEl("textarea", {
          cls: "notes-field",
          attr: { rows: "2", placeholder: "Notes..." },
        });
        textarea.value = entry.body.join("\n").trim();

        textarea.addEventListener("blur", async () => {
          await this.saveEntryBody(entry, textarea.value);
        });
      });

      // Ensure active styling is correct
      this.syncActiveCards();
    };

    // initial render
    await render();

    // rerender on file changes
    this.registerEvent(
      this.app.vault.on("modify", async (file) => {
        if (this.activeFile && file.path === this.activeFile.path) {
          await render();
        }
      })
    );
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  private setActiveIndex(idx: number): void {
    this.activeIndex = idx;
    this.syncActiveCards();

    const active = this.contentEl.querySelector(`.event[data-index='${idx}']`) as HTMLElement | null;
    active?.focus();
    active?.scrollIntoView({ block: "nearest" });
  }

  private syncActiveCards(): void {
    const cards = Array.from(this.contentEl.querySelectorAll(".event"));
    cards.forEach((el) => {
      const idx = Number((el as HTMLElement).dataset.index);
      el.classList.toggle("active", idx === this.activeIndex);
    });
  }

  private async saveEntryBody(entry: TimelineEntry, newBodyText: string): Promise<void> {
    if (!this.activeFile) return;

    const content = await this.app.vault.read(this.activeFile);
    const lines = content.split("\n");

    // Find the next time line after this entry
    const isTimeLine = (line: string) => /^\d{2}:\d{2}\b/.test(line);

    let end = entry.lineNo + 1;
    while (end < lines.length) {
      if (isTimeLine(lines[end])) break;
      if (lines[end].match(/^##/)) break;
      end++;
    }

    const normalized = newBodyText
      .split("\n")
      .map((l) => l.replace(/\s+$/, ""))
      .filter((l, idx, arr) => {
        // keep internal blank lines, but trim trailing empties
        if (idx < arr.length - 1) return true;
        return l.trim().length > 0;
      });

    const indented = normalized.map((l) => (l.trim().length === 0 ? "" : `      ${l.trimStart()}`));

    lines.splice(entry.lineNo + 1, end - (entry.lineNo + 1), ...indented);

    await this.app.vault.modify(this.activeFile, lines.join("\n"));
  }
}
