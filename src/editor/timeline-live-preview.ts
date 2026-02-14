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
import { isTimelineLine, parseTimelineLine } from "../parsing/timeline";
import { formatTime } from "../utils/time";
import { pathInFolder } from "../utils/folder-match";
import { openWikiLinkFromCard } from "../utils/timeline-link-open";
import {
  createTimelineCardModel,
  createTimelineHeaderModel,
  TimelineCardModel,
} from "../timeline/card-model";
import { renderTimelineCardDom, renderTimelineHeaderDom } from "../timeline/card-dom";

type TimelineEntry = {
  from: number; // doc offset start of block
  to: number; // doc offset end of block
  lineFrom: number; // doc offset start of the timestamp line
  timeFrom: number; // doc offset start of the visible time token
  timeTo: number; // doc offset end of the visible time token
  editPos: number; // doc offset for editing (head start)
  raw: string;
  model: TimelineCardModel;
};

function findTimeRangeInLine(text: string): { start: number; end: number } | null {
  const m = text.match(/`?(\d{1,2}[:.]\d{2}(?:\s*[–-]\s*\d{1,2}[:.]\d{2})?)`?/);
  if (!m) return null;
  const token = m[1];
  const matchText = m[0];
  const from = (m.index ?? 0) + matchText.indexOf(token);
  return { start: from, end: from + token.length };
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

class TimelineHeaderWidget extends WidgetType {
  constructor(private dateLabel: string) {
    super();
  }

  eq(other: TimelineHeaderWidget): boolean {
    return this.dateLabel === other.dateLabel;
  }

  toDOM(): HTMLElement {
    return renderTimelineHeaderDom(createTimelineHeaderModel(this.dateLabel));
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

  private enterEditTime(view: EditorView): void {
    view.dispatch({
      selection: { anchor: this.entry.timeFrom, head: this.entry.timeTo },
    });
    view.focus();
  }

  private openPrimaryLink(view: EditorView): void {
    if (!this.entry.model.primaryLinkTarget) return;

    const app = (window as unknown as { app?: unknown }).app;
    const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";

    void openWikiLinkFromCard(app as any, this.entry.model.primaryLinkTarget, sourcePath).then((opened) => {
      if (opened) return;
      this.enterEdit(view);
    });
  }

  private syncLinkedTaskStatus(done: boolean): void {
    const taskLinkPath = this.entry.model.taskLinkPath;
    if (!taskLinkPath) return;

    const app = (window as unknown as { app?: any }).app;
    if (!app?.vault) return;

    const path = normalizePath(taskLinkPath);
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
    if (this.entry.model.kind !== "task") return;

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
    const { root, cardEl } = renderTimelineCardDom(this.entry.model, {
      entryAriaLabel: `Timeline entry ${this.entry.model.time}`,
      actions: {
        onTimeClick: () => this.enterEditTime(view),
        onCardClick: () => this.enterEdit(view),
        onCardDoubleClick: () => this.enterEdit(view),
        onPrimaryClick: () => this.openPrimaryLink(view),
        onParticipantClick: (participant) => {
          const app = (window as unknown as { app?: unknown }).app;
          const sourcePath = view.state.field(editorInfoField, false)?.file?.path ?? "";

          void openWikiLinkFromCard(app as any, participant.target, sourcePath).then((opened) => {
            if (opened) return;
            view.dispatch({ selection: { anchor: this.entry.lineFrom } });
            view.focus();
          });
        },
        onJoinClick: (url) => openExternalUrl(url),
        onTaskToggle: this.entry.model.kind === "task" ? () => this.toggleTask(view) : undefined,
      },
    });

    cardEl.addEventListener("keydown", (e) => {
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        focusAdjacentCard(cardEl, 1);
        return;
      }

      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        focusAdjacentCard(cardEl, -1);
        return;
      }

      if (this.entry.model.kind === "task" && (e.key === "x" || e.key === "X" || e.key === " ")) {
        e.preventDefault();
        this.toggleTask(view);
        return;
      }

      if (e.key === "Enter" || e.key === "e") {
        e.preventDefault();
        this.enterEdit(view);
      }
    });

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
    const model = createTimelineCardModel({ time, head, bodyLines });

    const timeRange = findTimeRangeInLine(line.text);
    const timeFrom = timeRange ? line.from + timeRange.start : line.from;
    const timeTo = timeRange ? line.from + timeRange.end : line.from + parsed.timeText.length;

    entries.push({
      from: line.from,
      to: endLine.to,
      lineFrom: line.from,
      timeFrom,
      timeTo,
      editPos,
      raw: rawLines.join("\n"),
      model,
    });

    lineNo = endLineNo;
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

  const dateLabel = file instanceof TFile ? file.basename : "Today";
  builder.add(
    entries[0].from,
    entries[0].from,
    Decoration.widget({ widget: new TimelineHeaderWidget(dateLabel), block: true, side: -1 })
  );

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
