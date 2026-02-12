// ============================================================================
// Timeline Live Preview (CodeMirror 6)
//
// In Obsidian Live Preview (editor), replace timestamp blocks with rich cards.
// Markdown-first: underlying text remains valid markdown.
// Stable rendering: state-field decorations (CM6-safe for block widgets).
// ============================================================================

import { Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, WidgetType } from "@codemirror/view";
import { TFile, editorInfoField, editorLivePreviewField, normalizePath } from "obsidian";
import { TemporalDriftSettings } from "../types";
import {
  extractMeetingJoinUrl,
  extractParticipants,
  extractPrimaryLink,
  isTimelineLine,
  parseTaskHead,
  parseTimelineLine,
  stripEventIdSuffix,
  stripWikilinks,
} from "../parsing/timeline";
import { formatTime } from "../utils/time";
import { pathInFolder } from "../utils/folder-match";
import { openWikiLinkFromCard } from "../utils/timeline-link-open";

const MAX_BODY_LINES = 8;

type Participant = { target: string; display: string };

type TimelineEntry = {
  from: number; // doc offset start of block
  to: number; // doc offset end of block
  lineFrom: number; // doc offset start of the timestamp line
  editPos: number; // doc offset for editing (head start)
  time: string; // HH:mm or HH:mm–HH:mm
  title: string;
  locationText: string;
  participants: Participant[];
  bodyLines: string[];
  joinUrl: string | null;
  primaryLinkTarget: string | null;
  raw: string;
  kind: "event" | "task" | "note";
  taskDone: boolean;
  taskPriority: "now" | "next" | "later" | null;
  groupLabel: string | null;
  taskLinkPath: string | null;
};

function getFirstName(name: string): string {
  const cleaned = name.replace(/\[\[|\]\]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  return parts[0];
}

function parseTimeWindow(timeText: string): { start: number; end: number | null } | null {
  const start = timeText.match(/^(\d{2}):(\d{2})/);
  if (!start) return null;

  const startMinutes = Number(start[1]) * 60 + Number(start[2]);
  const end = timeText.match(/[–-](\d{2}):(\d{2})/);
  if (!end) return { start: startMinutes, end: null };

  return {
    start: startMinutes,
    end: Number(end[1]) * 60 + Number(end[2]),
  };
}

function isEntryNow(timeText: string, now = new Date()): boolean {
  const window = parseTimeWindow(timeText);
  if (!window) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (window.end !== null) {
    return currentMinutes >= window.start && currentMinutes <= window.end;
  }

  return currentMinutes >= window.start && currentMinutes < window.start + 60;
}

function focusAdjacentCard(current: HTMLElement, direction: 1 | -1): void {
  const scope = current.closest(".cm-content") ?? current.ownerDocument;
  const cards = Array.from(scope.querySelectorAll(".td-live-preview .event")) as HTMLElement[];
  const idx = cards.indexOf(current);
  if (idx < 0) return;

  const nextIdx = idx + direction;
  if (nextIdx < 0 || nextIdx >= cards.length) return;

  const next = cards[nextIdx];
  next.focus();
  next.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function openExternalUrl(url: string): void {
  const app = (window as unknown as { app?: any }).app;
  const openWithDefaultApp = app?.openWithDefaultApp as ((targetUrl: string) => void) | undefined;

  if (openWithDefaultApp) {
    openWithDefaultApp(url);
    return;
  }

  window.open(url);
}

function upsertFrontmatterKey(content: string, key: string, value: string): string {
  const fm = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fm) {
    return `---\n${key}: ${value}\n---\n\n${content}`;
  }

  const block = fm[1];
  const keyRe = new RegExp(`^${key}\\s*:\\s*.*$`, "m");
  const nextBlock = keyRe.test(block)
    ? block.replace(keyRe, `${key}: ${value}`)
    : `${block}\n${key}: ${value}`;

  return content.replace(fm[0], `---\n${nextBlock}\n---\n`);
}

function setFirstCheckboxLine(content: string, done: boolean): string {
  const marker = done ? "x" : " ";
  const lineRe = /^(\s*-?\s*\[)\s*([xX ]?)\s*(\].*)$/m;
  if (!lineRe.test(content)) return content;
  return content.replace(lineRe, `$1${marker}$3`);
}

class EmptyDailyStateWidget extends WidgetType {
  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "td-live-preview td-empty-state";

    const card = document.createElement("div");
    card.className = "td-empty-card";

    const title = document.createElement("div");
    title.className = "td-empty-title";
    title.textContent = "Start your timeline";

    const subtitle = document.createElement("div");
    subtitle.className = "td-empty-subtitle";
    subtitle.textContent = "Add your first timestamp entry to begin.";

    const btn = document.createElement("button");
    btn.className = "td-empty-action";
    btn.type = "button";
    btn.setAttribute("aria-label", "Insert first timestamp");
    btn.textContent = `${formatTime(new Date())} — `;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const insert = `${formatTime(new Date())} — `;
      const at = view.state.doc.length;
      view.dispatch({
        changes: { from: at, to: at, insert },
        selection: { anchor: at + insert.length },
      });
      view.focus();
    });

    card.appendChild(title);
    card.appendChild(subtitle);
    card.appendChild(btn);
    root.appendChild(card);

    return root;
  }
}

class TimelineCardWidget extends WidgetType {
  constructor(private entry: TimelineEntry) {
    super();
  }

  eq(other: TimelineCardWidget): boolean {
    return this.entry.raw === other.entry.raw;
  }

  private enterEdit(view: EditorView): void {
    view.dispatch({ selection: { anchor: this.entry.editPos } });
    view.focus();
  }

  private syncLinkedTaskStatus(done: boolean): void {
    if (!this.entry.taskLinkPath) return;

    const app = (window as unknown as { app?: any }).app;
    if (!app?.vault) return;

    const path = normalizePath(this.entry.taskLinkPath);
    const af = app.vault.getAbstractFileByPath(path);
    if (!(af instanceof TFile)) return;

    void app.vault.process(af, (content: string) => {
      let next = content;
      next = upsertFrontmatterKey(next, "status", done ? "done" : "open");
      next = upsertFrontmatterKey(next, "done", done ? "true" : "false");
      next = setFirstCheckboxLine(next, done);
      return next;
    });
  }

  private toggleTask(view: EditorView): void {
    if (this.entry.kind !== "task") return;

    const line = view.state.doc.lineAt(this.entry.lineFrom);
    const parsed = parseTimelineLine(line.text);
    if (!parsed) return;

    const m = parsed.head.match(/^(-?\s*)\[\s*([xX ]?)\s*\](\s*)(.*)$/);
    if (!m) return;

    const prefix = m[1] ?? "";
    const mark = (m[2] ?? "").toLowerCase();
    const gap = m[3] && m[3].length > 0 ? m[3] : " ";
    const title = m[4] ?? "";

    const nextMark = mark === "x" ? " " : "x";
    const nextHead = `${prefix}[${nextMark}]${gap}${title}`;

    const from = line.from + parsed.headStart;
    view.dispatch({
      changes: { from, to: line.to, insert: nextHead },
    });
    this.syncLinkedTaskStatus(nextMark === "x");
    view.focus();
  }

  toDOM(view: EditorView): HTMLElement {
    const root = document.createElement("div");
    root.className = "td-live-preview";

    const hour = document.createElement("div");
    hour.className = "hour";

    const timeEl = document.createElement("div");
    timeEl.className = "hour-time";

    if (isEntryNow(this.entry.time)) {
      hour.classList.add("now");
      timeEl.classList.add("is-now");
      const dot = document.createElement("span");
      dot.className = "now-dot";
      dot.textContent = "●";
      timeEl.appendChild(dot);
    }

    timeEl.appendChild(document.createTextNode(this.entry.time));

    const slot = document.createElement("div");
    slot.className = "hour-slot";

    if (this.entry.groupLabel) {
      const groupLabel = document.createElement("div");
      groupLabel.className = "event-group-label";
      groupLabel.textContent = this.entry.groupLabel;
      slot.appendChild(groupLabel);
    }

    const card = document.createElement("div");
    card.className = "event";
    if (this.entry.kind === "task") card.classList.add("event--task");
    if (this.entry.kind === "task" && this.entry.taskDone) card.classList.add("event--task-done");
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `Timeline entry ${this.entry.time}`);

    const headline = document.createElement("div");
    headline.className = "event-headline";

    if (this.entry.kind === "task") {
      const bubble = document.createElement("button");
      bubble.type = "button";
      bubble.className = `task-bubble${this.entry.taskDone ? " done" : ""}`;
      bubble.setAttribute("aria-label", this.entry.taskDone ? "Mark task as open" : "Mark task as done");
      if (this.entry.taskDone) bubble.textContent = "✓";
      bubble.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleTask(view);
      });
      headline.appendChild(bubble);

      const title = document.createElement("span");
      title.className = "event-title";
      if (this.entry.taskDone) title.classList.add("task-title-done");
      title.textContent = this.entry.title;
      headline.appendChild(title);

      if (this.entry.taskPriority) {
        const priority = document.createElement("span");
        priority.className = `task-priority task-priority-${this.entry.taskPriority}`;
        priority.textContent = `#${this.entry.taskPriority}`;
        headline.appendChild(priority);
      }
    } else {
      const title = document.createElement("span");
      title.className = "event-title";
      title.textContent = this.entry.title;
      headline.appendChild(title);

      if (this.entry.locationText) {
        const location = document.createElement("span");
        location.className = "event-at";
        location.textContent = ` @ ${this.entry.locationText}`;
        headline.appendChild(location);
      }

      const joinUrl = this.entry.joinUrl;
      if (joinUrl) {
        const join = document.createElement("a");
        join.className = "join-pill";
        join.href = "#";
        join.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>join`;
        join.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          openExternalUrl(joinUrl);
        });
        headline.appendChild(join);
      }
    }

    card.appendChild(headline);

    if (this.entry.participants.length > 0) {
      const peopleRow = document.createElement("div");
      peopleRow.className = "people-row";

      for (const p of this.entry.participants) {
        const person = document.createElement("a");
        person.className = "person-badge";
        person.href = "#";
        person.setAttribute("role", "button");
        person.setAttribute("aria-label", `Open ${p.display}`);
        person.textContent = getFirstName(p.display);

        person.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();

          const app = (window as unknown as { app?: unknown }).app;
          const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";

          void openWikiLinkFromCard(app as any, p.target, sourcePath).then((opened) => {
            if (opened) return;
            view.dispatch({ selection: { anchor: this.entry.lineFrom } });
            view.focus();
          });
        });

        peopleRow.appendChild(person);
      }

      card.appendChild(peopleRow);
    }

    const nonEmptyBody = this.entry.bodyLines.filter((line) => line.trim().length > 0);
    if (nonEmptyBody.length > 0) {
      const bodyLine = document.createElement("div");
      bodyLine.className = "briefing-line";

      const label = document.createElement("span");
      label.className = "briefing-label";
      label.textContent = this.entry.kind === "task" ? "DETAILS" : "BRIEFING";
      bodyLine.appendChild(label);

      const text = document.createElement("span");
      text.className = "briefing-text";
      const visible = nonEmptyBody.slice(0, MAX_BODY_LINES).map((line) => {
        const cleaned = line.trim().replace(/^[-*+]\s+/, "• ");
        return stripWikilinks(cleaned);
      });
      const overflow = nonEmptyBody.length - visible.length;
      if (overflow > 0) visible.push(`… +${overflow} more`);
      text.textContent = visible.join(" ");
      bodyLine.appendChild(text);

      card.appendChild(bodyLine);
    }

    card.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();

      const app = (window as unknown as { app?: unknown }).app;
      const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";

      void openWikiLinkFromCard(app as any, this.entry.primaryLinkTarget ?? "", sourcePath).then((opened) => {
        if (!opened) card.focus();
      });
    });

    card.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enterEdit(view);
    });

    card.addEventListener("keydown", (e) => {
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusAdjacentCard(card, 1);
        return;
      }

      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusAdjacentCard(card, -1);
        return;
      }

      if (this.entry.kind === "task" && (e.key === "x" || e.key === "X" || e.key === " ")) {
        e.preventDefault();
        this.toggleTask(view);
        return;
      }

      if (e.key === "Enter" || e.key === "e") {
        e.preventDefault();
        this.enterEdit(view);
      }
    });

    slot.appendChild(card);
    hour.appendChild(timeEl);
    hour.appendChild(slot);
    root.appendChild(hour);

    return root;
  }
}

function buildEntriesFromDoc(doc: EditorView["state"]["doc"]): TimelineEntry[] {
  const entries: TimelineEntry[] = [];

  for (let lineNo = 1; lineNo <= doc.lines; lineNo++) {
    const line = doc.line(lineNo);
    const parsed = parseTimelineLine(line.text);
    if (!parsed) continue;

    const time = parsed.timeText;
    const head = parsed.head;
    const editPos = head.length > 0 ? line.from + parsed.headStart : line.to;

    const bodyLines: string[] = [];
    const rawLines: string[] = [line.text];
    let endLineNo = line.number;

    for (let ln = line.number + 1; ln <= doc.lines; ln++) {
      const next = doc.line(ln);
      const text = next.text;

      if (isTimelineLine(text)) break;
      if (/^##/.test(text)) break;

      if (text.trim() === "") {
        bodyLines.push("");
        rawLines.push(text);
        endLineNo = ln;
        continue;
      }

      if (!/^(\s+|[-*+]\s)/.test(text)) break;

      bodyLines.push(text.replace(/^\s+/, ""));
      rawLines.push(text);
      endLineNo = ln;
    }

    const endLine = doc.line(endLineNo);

    const task = parseTaskHead(head);
    const primary = extractPrimaryLink(head);
    const participants = task.isTask ? [] : extractParticipants(head);

    const taskLinkPath = (() => {
      if (!task.isTask) return null;
      const m = head.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
      return m?.[1]?.trim() || null;
    })();

    const kind: "event" | "task" | "note" = task.isTask ? "task" : primary ? "event" : "note";

    const joinUrl = kind === "event" ? extractMeetingJoinUrl([head, ...bodyLines]) : null;

    const title = (() => {
      if (task.isTask) {
        return stripWikilinks(task.title || "(empty task)");
      }
      if (primary) return stripEventIdSuffix(primary.display);
      const plain = head.split(" with ")[0];
      return stripEventIdSuffix(stripWikilinks(plain || "(empty)"));
    })();

    const locationText = (() => {
      if (!primary || task.isTask) return "";
      let t = head;
      t = t.replace(/^\s*\[\[[^\]]+\]\]\s*/, "");
      const withIdx = t.indexOf(" with ");
      if (withIdx >= 0) t = t.slice(0, withIdx);
      return stripWikilinks(t).trim();
    })();

    const raw = rawLines.join("\n");

    entries.push({
      from: line.from,
      to: endLine.to,
      lineFrom: line.from,
      editPos,
      time,
      title,
      locationText,
      participants,
      bodyLines,
      joinUrl,
      primaryLinkTarget: primary?.target ?? null,
      raw,
      kind,
      taskDone: task.done,
      taskPriority: task.priority,
      groupLabel: null,
      taskLinkPath,
    });

    lineNo = endLineNo;
  }

  let lastTaskState: boolean | null = null;
  for (const entry of entries) {
    if (entry.kind !== "task") continue;

    if (lastTaskState === null || lastTaskState !== entry.taskDone) {
      entry.groupLabel = entry.taskDone ? "Done tasks" : "Open tasks";
      lastTaskState = entry.taskDone;
    }
  }

  return entries;
}

function selectionOverlaps(selection: EditorView["state"]["selection"], from: number, to: number): boolean {
  for (const range of selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

function buildDecorationsFromState(state: EditorView["state"], settings: TemporalDriftSettings): DecorationSet {
  const editorInfo = state.field(editorInfoField, false);
  const file = editorInfo?.file;
  const filePath = file?.path ? normalizePath(file.path) : "";

  if (!filePath || !pathInFolder(filePath, settings.dailyNotesFolder, ["Daily notes"])) {
    return Decoration.none;
  }

  const entries = buildEntriesFromDoc(state.doc);

  if (entries.length === 0) {
    const isEmptyDoc = state.doc.toString().trim().length === 0;
    if (!isEmptyDoc) return Decoration.none;

    const builder = new RangeSetBuilder<Decoration>();
    builder.add(0, 0, Decoration.widget({ widget: new EmptyDailyStateWidget(), block: true, side: 1 }));
    return builder.finish();
  }

  entries.sort((a, b) => a.from - b.from);

  const builder = new RangeSetBuilder<Decoration>();
  const selection = state.selection;

  for (const entry of entries) {
    // If selection is inside entry, keep raw markdown visible for editing.
    if (selectionOverlaps(selection, entry.from, entry.to)) continue;

    builder.add(entry.from, entry.to, Decoration.replace({ widget: new TimelineCardWidget(entry), block: true }));
  }

  return builder.finish();
}

function createTimelineLivePreview(settings: TemporalDriftSettings): Extension {
  return StateField.define<DecorationSet>({
    create(state) {
      return buildDecorationsFromState(state, settings);
    },
    update(_value, tr) {
      if (!tr.docChanged && !tr.selection) {
        const hadLivePreviewField = tr.startState.field(editorLivePreviewField, false);
        const hasLivePreviewField = tr.state.field(editorLivePreviewField, false);
        if (hadLivePreviewField === hasLivePreviewField) {
          const beforePath = tr.startState.field(editorInfoField, false)?.file?.path ?? "";
          const afterPath = tr.state.field(editorInfoField, false)?.file?.path ?? "";
          if (beforePath === afterPath) {
            return _value;
          }
        }
      }

      return buildDecorationsFromState(tr.state, settings);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}

export class TimelineLivePreviewExtension {
  private extension: Extension[] = [];
  private settings: TemporalDriftSettings;

  constructor(settings: TemporalDriftSettings) {
    this.settings = settings;
    this.rebuild();
  }

  getExtension(): Extension[] {
    return this.extension;
  }

  updateSettings(settings: TemporalDriftSettings): void {
    this.settings = settings;
    this.rebuild();
  }

  private rebuild(): void {
    this.extension.length = 0;
    this.extension.push(createTimelineLivePreview(this.settings));
  }
}
