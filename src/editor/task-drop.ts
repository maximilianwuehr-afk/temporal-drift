import { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { editorInfoField } from "obsidian";
import { TemporalDriftSettings } from "../types";
import { parseTimelineLine } from "../parsing/timeline";
import { formatTime } from "../utils/time";
import { pathInFolder } from "../utils/folder-match";
const TD_TASK_MIME = "application/x-temporal-drift-task";

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

function currentLineTimeOrNow(view: EditorView, pos: number): string {
  const line = view.state.doc.lineAt(pos);
  const parsed = parseTimelineLine(line.text);
  if (!parsed) return formatTime(new Date());

  const time = parsed.timeText;
  const rangeSplit = time.split("–")[0]?.trim();
  return rangeSplit || formatTime(new Date());
}

function buildInsertLine(payload: DragTaskPayload, time: string): string {
  const link = `[[${payload.path}|${payload.title}]]`;
  const priority = payload.priority ? ` #${payload.priority}` : "";
  return `${time} — [ ] ${link}${priority}`;
}

function createTaskDropExtension(settings: TemporalDriftSettings): Extension {
  return EditorView.domEventHandlers({
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
        return false;
      }

      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      return true;
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
        return false;
      }

      event.preventDefault();

      const coords = { x: event.clientX, y: event.clientY };
      const pos = view.posAtCoords(coords) ?? view.state.selection.main.head;
      const line = view.state.doc.lineAt(pos);

      const time = currentLineTimeOrNow(view, pos);
      const insertLine = buildInsertLine(payload, time);

      const insertion = line.length === 0 ? insertLine : `\n${insertLine}`;
      const from = line.length === 0 ? line.from : line.to;

      view.dispatch({
        changes: { from, to: from, insert: insertion },
        selection: { anchor: from + insertion.length },
      });
      view.focus();
      return true;
    },
  });
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
