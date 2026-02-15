// ============================================================================
// Task Link Overlay (editor-first)
//
// Goal: show lightweight, non-jumpy task info inline for task wikilinks.
// - No block widgets. Only mark decorations on the wikilink range.
// - Decorations are suppressed when the cursor/selection overlaps the link,
//   so editing behaves like normal Obsidian.
//
// This is inspired by TaskNotes' "Task Link Overlays" behavior.
// ============================================================================

import { Extension, RangeSetBuilder } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { App, TFile, editorInfoField } from "obsidian";

import { TemporalDriftSettings } from "../types";
import { parseTaskHead, parseTimelineLine } from "../parsing/timeline";
import { pathInFolder } from "../utils/folder-match";

function selectionOverlaps(selection: EditorView["state"]["selection"], from: number, to: number): boolean {
  for (const range of selection.ranges) {
    if (range.from <= to && range.to >= from) return true;
  }
  return false;
}

function normalizeDate(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const v = raw.trim();
  // Accept YYYY-MM-DD or full ISO; keep day.
  const day = v.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  return day;
}

function buildDecorations(app: App, view: EditorView, settings: TemporalDriftSettings): DecorationSet {
  if (!view.visibleRanges || view.visibleRanges.length === 0) return Decoration.none;

  const editorInfo = view.state.field(editorInfoField, false);
  const file = editorInfo?.file;
  const sourcePath = file?.path ?? "";

  if (!sourcePath || !pathInFolder(sourcePath, settings.dailyNotesFolder, ["Daily notes"])) {
    return Decoration.none;
  }

  const builder = new RangeSetBuilder<Decoration>();
  const selection = view.state.selection;

  const statusKey = settings.taskFieldStatus || "status";
  const doneKey = settings.taskFieldDone || "done";
  const priorityKey = settings.taskFieldPriority || "priority";
  const dueKey = settings.taskFieldDue || "due";

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      if (line.from > to) break;

      const parsed = parseTimelineLine(line.text);
      if (!parsed) {
        pos = line.to + 1;
        continue;
      }

      // Only overlay on task lines.
      if (!parseTaskHead(parsed.headRaw).isTask) {
        pos = line.to + 1;
        continue;
      }

      // Find wikilinks in the head.
      const head = parsed.headRaw;
      const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
      let match: RegExpExecArray | null;

      while ((match = re.exec(head))) {
        const target = (match[1] ?? "").trim();
        if (!target) continue;

        const linked = app.metadataCache.getFirstLinkpathDest(target, sourcePath);
        if (!(linked instanceof TFile)) continue;
        if (!pathInFolder(linked.path, settings.tasksFolder, ["Tasks"])) continue;

        const cache = app.metadataCache.getFileCache(linked);
        const fm = (cache?.frontmatter ?? {}) as Record<string, unknown>;

        const status = typeof fm[statusKey] === "string" ? String(fm[statusKey]).toLowerCase() : "open";
        const done = typeof fm[doneKey] === "boolean" ? Boolean(fm[doneKey]) : status === "done";
        const priority = typeof fm[priorityKey] === "string" ? String(fm[priorityKey]).toLowerCase() : "";
        const due = normalizeDate(fm[dueKey]);

        // Compute absolute document positions for the wikilink.
        const startInHead = match.index;
        const endInHead = match.index + match[0].length;

        const fromPos = line.from + parsed.headStart + startInHead;
        const toPos = line.from + parsed.headStart + endInHead;

        if (selectionOverlaps(selection, fromPos, toPos)) continue;

        const classes = ["td-tasklink", done ? "td-tasklink--done" : "td-tasklink--open"];
        if (priority) classes.push(`td-tasklink--${priority}`);
        if (due) classes.push("td-tasklink--due");

        const titleParts = [`Status: ${done ? "done" : status || "open"}`];
        if (priority) titleParts.push(`Priority: ${priority}`);
        if (due) titleParts.push(`Due: ${due}`);

        builder.add(
          fromPos,
          toPos,
          Decoration.mark({
            class: classes.join(" "),
            attributes: {
              title: titleParts.join(" · "),
              "data-td-due": due,
              "data-td-status": done ? "done" : status || "open",
            },
          })
        );
      }

      pos = line.to + 1;
    }
  }

  return builder.finish();
}

export class TaskLinkOverlayExtension {
  private extension: Extension[] = [];
  private app: App;
  private settings: TemporalDriftSettings;

  constructor(app: App, settings: TemporalDriftSettings) {
    this.app = app;
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
    const app = this.app;
    const settings = this.settings;

    this.extension.length = 0;
    this.extension.push(
      ViewPlugin.fromClass(
        class {
          decorations: DecorationSet = Decoration.none;

          update(update: ViewUpdate): void {
            if (update.docChanged || update.viewportChanged || update.selectionSet || this.decorations === Decoration.none) {
              this.decorations = buildDecorations(app, update.view, settings);
            }
          }
        },
        {
          decorations: (v) => v.decorations,
        }
      )
    );
  }
}
