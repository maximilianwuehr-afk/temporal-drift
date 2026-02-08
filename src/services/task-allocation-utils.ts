import { parseTaskHead, parseTimelineLine } from "../parsing/timeline";

export type TaskPriority = "now" | "next" | "later" | null;

export interface TaskSnapshot {
  done: boolean;
  priority: TaskPriority;
}

const PRIORITY_MARKER_RE = /(?:^|\s)(?:#now|#next|#later|@now|@next|@later|\[now\]|\[next\]|\[later\]|\(now\)|\(next\)|\(later\))(?=\s|$)/gi;

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function stripMdExt(path: string): string {
  return path.replace(/\.md$/i, "");
}

function parsePriority(value: unknown): TaskPriority {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "now" || normalized === "next" || normalized === "later" ? normalized : null;
}

function inferDoneFromContent(content: string): boolean {
  const m = content.match(/^(?:\s*-\s*)?\[\s*([xX ])\s*\]/m);
  return (m?.[1] ?? "").toLowerCase() === "x";
}

function inferPriorityFromContent(content: string): TaskPriority {
  const m = content.match(/(?:^|\s)(?:#|@)(now|next|later)(?=\s|$)/i);
  if (m?.[1]) return parsePriority(m[1]);

  const alt = content.match(/(?:^|\s)(?:\[(now|next|later)\]|\((now|next|later)\))(?=\s|$)/i);
  return parsePriority(alt?.[1] ?? alt?.[2]);
}

export function parseTaskSnapshotFromContent(
  content: string,
  frontmatter?: Record<string, unknown>
): TaskSnapshot {
  const fmStatus = typeof frontmatter?.status === "string" ? frontmatter.status.toLowerCase().trim() : "";

  const fmDoneRaw = frontmatter?.done;
  const fmDone =
    fmDoneRaw === true ||
    (typeof fmDoneRaw === "string" && ["true", "yes", "1"].includes(fmDoneRaw.toLowerCase()));

  const done =
    fmDone ||
    ["done", "closed", "complete", "completed"].includes(fmStatus) ||
    inferDoneFromContent(content);

  const fmPriority = parsePriority(frontmatter?.priority);
  const priority = fmPriority ?? inferPriorityFromContent(content);

  return { done, priority };
}

export function taskLinkMatches(linkTarget: string, taskPath: string): boolean {
  const normalizedLink = normalizeVaultPath(linkTarget);
  const normalizedTask = normalizeVaultPath(taskPath);

  if (normalizedLink === normalizedTask) return true;
  if (stripMdExt(normalizedLink) === stripMdExt(normalizedTask)) return true;

  const taskBase = stripMdExt(normalizedTask).split("/").pop() ?? normalizedTask;
  const linkBase = stripMdExt(normalizedLink).split("/").pop() ?? normalizedLink;
  return linkBase === taskBase;
}

function updateTaskHead(head: string, snapshot: TaskSnapshot): string {
  const task = parseTaskHead(head);
  if (!task.isTask) return head;

  const checkboxRe = /^(\s*-?\s*)\[\s*[xX ]?\s*\]\s*(.*)$/;
  const match = head.match(checkboxRe);
  if (!match) return head;

  const rest = (match[2] ?? "").replace(PRIORITY_MARKER_RE, " ").replace(/\s{2,}/g, " ").trim();
  const prioritySuffix = snapshot.priority ? ` #${snapshot.priority}` : "";
  const nextRest = `${rest}${prioritySuffix}`.trim();

  return `${match[1]}[${snapshot.done ? "x" : " "}]${nextRest ? ` ${nextRest}` : ""}`;
}

export function applyTaskSnapshotToTimelineLine(
  line: string,
  taskPath: string,
  snapshot: TaskSnapshot
): string {
  const parsed = parseTimelineLine(line);
  if (!parsed) return line;

  const head = parsed.headRaw;
  if (!parseTaskHead(head).isTask) return line;

  const link = head.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  if (!link?.[1]) return line;
  if (!taskLinkMatches(link[1].trim(), taskPath)) return line;

  const nextHead = updateTaskHead(head, snapshot);
  if (nextHead === head) return line;

  return `${line.slice(0, parsed.headStart)}${nextHead}`;
}
