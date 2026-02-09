import { Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, DecorationSet, EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { TemporalDriftSettings } from "../types";
import { parseTimelineLine } from "../parsing/timeline";
import { formatTime } from "../utils/time";
import { pathInFolder } from "../utils/folder-match";

const TD_TASK_MIME = "application/x-temporal-drift-task";

type DropHint = { lineFrom: number; className: string };

const setDropHintEffect = StateEffect.define<DropHint | null>();

const dropHintField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    let next = value.map(tr.changes);

    for (const e of tr.effects) {
      if (e.is(setDropHintEffect)) {
        if (!e.value) return Decoration.none;
        const deco = Decoration.line({ class: e.value.className }).range(e.value.lineFrom);
        return Decoration.set([deco], true);
      }
    }

    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

type DragTaskPayload = {
  path: string;
  title: string;
  priority?: "now" | "next" | "later" | null;
  done?: boolean;
};

function safeParsePayload(raw: string): DragTaskPayload | null {
  try {
    const parsed = JSON.parse(raw) as DragTaskPayload;
    if (!parsed?.path || !parsed?.title) return null;
    return parsed;
  } catch {
    return null;
  }
}

function fromPlainText(raw: string): DragTaskPayload | null {
  const m = raw.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
  if (!m) return null;
  const path = m[1].trim();
  const title = (m[2] ?? path.split("/").pop() ?? path).trim();
  return { path, title };
}

function getDropPayload(e: DragEvent): DragTaskPayload | null {
  if (!e.dataTransfer) return null;

  const raw = e.dataTransfer.getData(TD_TASK_MIME);
  if (raw) {
    const payload = safeParsePayload(raw);
    if (payload) return payload;
  }

  const plain = e.dataTransfer.getData("text/plain");
  if (plain) return fromPlainText(plain);

  return null;
}

function extractStartTime(text: string): string | null {
  const parsed = parseTimelineLine(text);
  if (!parsed) return null;
  const time = parsed.timeText;
  const rangeSplit = time.split("–")[0]?.trim();
  return rangeSplit || null;
}

function findClosestSlotTime(view: EditorView, pos: number): string {
  const doc = view.state.doc;
  const centerLine = doc.lineAt(pos).number;

  // Prefer exact line match first.
  const current = extractStartTime(doc.line(centerLine).text);
  if (current) return current;

  // Otherwise search outward for the nearest timestamp line.
  const MAX_SCAN = 80;
  for (let d = 1; d <= MAX_SCAN; d++) {
    const up = centerLine - d;
    if (up >= 1) {
      const t = extractStartTime(doc.line(up).text);
      if (t) return t;
    }

    const down = centerLine + d;
    if (down <= doc.lines) {
      const t = extractStartTime(doc.line(down).text);
      if (t) return t;
    }
  }

  return formatTime(new Date());
}

function buildInsertLine(payload: DragTaskPayload, time: string): string {
  const link = `[[${payload.path}|${payload.title}]]`;
  const priority = payload.priority ? ` #${payload.priority}` : "";
  return `${time} — [ ] ${link}${priority}`;
}

function createTaskDropExtension(settings: TemporalDriftSettings): Extension {
  let lastHint: DropHint | null = null;

  const clearHint = (view: EditorView) => {
    if (!lastHint) return;
    lastHint = null;
    view.dispatch({ effects: setDropHintEffect.of(null) });
  };

  const updateHint = (view: EditorView, lineFrom: number, insertAbove: boolean) => {
    const className = insertAbove ? "td-drop-target-above" : "td-drop-target-below";
    if (lastHint?.lineFrom === lineFrom && lastHint?.className === className) return;
    lastHint = { lineFrom, className };
    view.dispatch({ effects: setDropHintEffect.of(lastHint) });
  };

  return [
    dropHintField,
    EditorView.domEventHandlers({
      dragover: (event, view): boolean => {
        const payload = getDropPayload(event);
        if (!payload) return false;

        let filePath: string | null = null;
        try {
          const editorInfo = view.state.field(editorInfoField, false);
          filePath = editorInfo?.file?.path ?? null;
        } catch {
          return false;
        }

        if (!filePath || !pathInFolder(filePath, settings.dailyNotesFolder, ["Daily notes"])) {
          clearHint(view);
          return false;
        }

        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";

        const coords = { x: event.clientX, y: event.clientY };
        const pos = view.posAtCoords(coords) ?? view.state.selection.main.head;
        const block = view.lineBlockAt(pos);
        const insertAbove = event.clientY < (block.top + block.bottom) / 2;
        const line = view.state.doc.lineAt(pos);

        updateHint(view, line.from, insertAbove);

        return true;
      },

      dragleave: (_event, view): boolean => {
        clearHint(view);
        return false;
      },

      drop: (event, view): boolean => {
        const payload = getDropPayload(event);
        if (!payload) return false;

        let filePath: string | null = null;
        try {
          const editorInfo = view.state.field(editorInfoField, false);
          filePath = editorInfo?.file?.path ?? null;
        } catch {
          return false;
        }

        if (!filePath || !pathInFolder(filePath, settings.dailyNotesFolder, ["Daily notes"])) {
          clearHint(view);
          return false;
        }

        event.preventDefault();

        const coords = { x: event.clientX, y: event.clientY };
        const pos = view.posAtCoords(coords) ?? view.state.selection.main.head;
        const block = view.lineBlockAt(pos);
        const insertAbove = event.clientY < (block.top + block.bottom) / 2;

        const line = view.state.doc.lineAt(pos);

        const time = findClosestSlotTime(view, pos);
        const insertLine = buildInsertLine(payload, time);

        const insertion = insertAbove
          ? `${insertLine}\n`
          : line.length === 0
            ? insertLine
            : `\n${insertLine}`;

        const from = insertAbove ? line.from : line.length === 0 ? line.from : line.to;

        clearHint(view);

        view.dispatch({
          changes: { from, to: from, insert: insertion },
          selection: { anchor: from + insertion.length },
        });
        view.focus();
        return true;
      },
    }),
  ];
}

export class TaskDropExtension {
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
    this.extension.push(createTaskDropExtension(this.settings));
  }
}
