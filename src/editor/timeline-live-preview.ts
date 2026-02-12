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
  raw: string;
  kind: "event" | "task" | "note";
  taskDone: boolean;
  taskPriority: "now" | "next" | "later" | null;
  groupLabel: string | null;
  taskLinkPath: string | null;
};

function getInitials(name: string): string {
  const cleaned = name.replace(/\[\[|\]\]/g, "").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
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
    timeEl.textContent = this.entry.time;

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

    const top = document.createElement("div");
    top.className = "event-top";

    const left = document.createElement("div");

    if (this.entry.kind === "task") {
      const taskRow = document.createElement("div");
      taskRow.className = "event-task-row";

      const taskToggle = document.createElement("input");
      taskToggle.className = "event-task-checkbox";
      taskToggle.type = "checkbox";
      taskToggle.checked = this.entry.taskDone;
      taskToggle.setAttribute("aria-label", this.entry.taskDone ? "Mark task as open" : "Mark task as done");
      taskToggle.addEventListener("click", (e) => {
        e.stopPropagation();
      });
      taskToggle.addEventListener("change", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleTask(view);
      });

      const title = document.createElement("div");
      title.className = "event-title";
      title.textContent = this.entry.title;

      taskRow.appendChild(taskToggle);
      taskRow.appendChild(title);
      left.appendChild(taskRow);
    } else {
      const title = document.createElement("div");
      title.className = "event-title";
      title.textContent = this.entry.title;
      left.appendChild(title);
    }

    if (this.entry.locationText) {
      const loc = document.createElement("div");
      loc.className = "event-location";
      loc.textContent = this.entry.locationText;
      left.appendChild(loc);
    }

    const right = document.createElement("div");
    right.className = "event-right";

    if (this.entry.kind === "task" && this.entry.taskPriority) {
      const chip = document.createElement("span");
      chip.className = `event-priority-chip event-priority-${this.entry.taskPriority}`;
      chip.textContent = this.entry.taskPriority;
      right.appendChild(chip);
    }

    const duration = document.createElement("span");
    duration.className = "event-duration";
    duration.textContent = "";
    right.appendChild(duration);

    const joinUrl = this.entry.kind === "event" ? this.entry.joinUrl : null;
    if (joinUrl) {
      const joinBtn = document.createElement("button");
      joinBtn.className = "event-join-btn";
      joinBtn.setAttribute("type", "button");
      joinBtn.setAttribute("aria-label", "Join meeting");
      joinBtn.setAttribute("title", "Join meeting");
      joinBtn.textContent = "Join";
      joinBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        openExternalUrl(joinUrl);
      });
      right.appendChild(joinBtn);
    }

    const editBtn = document.createElement("button");
    editBtn.className = "event-edit-btn";
    editBtn.setAttribute("type", "button");
    editBtn.setAttribute("aria-label", "Edit entry");
    editBtn.setAttribute("title", "Edit");
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.enterEdit(view);
    });
    right.appendChild(editBtn);

    top.appendChild(left);
    top.appendChild(right);
    card.appendChild(top);

    if (this.entry.participants.length > 0) {
      const pWrap = document.createElement("div");
      pWrap.className = "event-participants";

      for (const p of this.entry.participants) {
        const a = document.createElement("a");
        a.className = "participant";
        a.href = "#";
        a.setAttribute("role", "button");
        a.setAttribute("aria-label", `Jump to ${p.display}`);

        const av = document.createElement("span");
        av.className = "participant-avatar";
        av.textContent = getInitials(p.display);

        a.appendChild(av);
        a.appendChild(document.createTextNode(p.display));

        a.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          view.dispatch({ selection: { anchor: this.entry.lineFrom } });
          view.focus();
        });

        pWrap.appendChild(a);
      }

      card.appendChild(pWrap);
    }

    if (this.entry.bodyLines.length > 0) {
      const body = document.createElement("div");
      body.className = "event-body";

      const nonEmptyBody = this.entry.bodyLines.filter((l) => l.trim().length > 0);
      const overflow = nonEmptyBody.length - MAX_BODY_LINES;
      const visible = nonEmptyBody.slice(0, MAX_BODY_LINES);

      if (this.entry.kind === "task") {
        const taskList = document.createElement("div");
        taskList.className = "event-subtasks";

        for (const line of visible) {
          const item = document.createElement("div");
          item.className = "event-subtask";

          const parsed = parseTaskHead(line);
          if (parsed.isTask) {
            const mark = document.createElement("input");
            mark.className = "event-subtask-checkbox";
            mark.type = "checkbox";
            mark.checked = parsed.done;
            mark.disabled = true;

            const text = document.createElement("span");
            text.className = "event-subtask-text";
            text.textContent = stripWikilinks(parsed.title);
            if (parsed.done) text.classList.add("event-subtask-text-done");

            item.appendChild(mark);
            item.appendChild(text);
          } else {
            const text = document.createElement("span");
            text.className = "event-subtask-text";
            text.textContent = stripWikilinks(line);
            item.appendChild(text);
          }

          taskList.appendChild(item);
        }

        if (overflow > 0) {
          const more = document.createElement("div");
          more.className = "event-subtask-more";
          more.textContent = `… +${overflow} more`;
          taskList.appendChild(more);
        }

        body.appendChild(taskList);
      } else {
        const pre = document.createElement("div");
        pre.className = "event-body-text";
        const textLines = visible.map(stripWikilinks);
        if (overflow > 0) {
          textLines.push(`… +${overflow} more`);
        }
        pre.textContent = textLines.join("\n");
        body.appendChild(pre);
      }

      card.appendChild(body);
    }

    card.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      card.focus();
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

      if (!/^\s+/.test(text)) break;

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
