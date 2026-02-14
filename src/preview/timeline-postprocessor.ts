// ============================================================================
// Timeline Reading View Post Processor
//
// Renders prototype-style timeline cards in Reading View (markdown preview).
// Live Preview is handled separately via CM6 widgets.
// ============================================================================

import { MarkdownPostProcessorContext, MarkdownView, TFile, normalizePath } from "obsidian";
import { pathInFolder } from "../utils/folder-match";
import { openWikiLinkFromCard } from "../utils/timeline-link-open";
import type TemporalDriftPlugin from "../main";
import { isTimelineLine, parseTimelineLine } from "../parsing/timeline";
import { createTimelineCardModel, TimelineCardModel } from "../timeline/card-model";
import { renderTimelineCardDom } from "../timeline/card-dom";

type ParsedEntry = {
  lineStart: number; // 0-based line index
  lineEnd: number; // inclusive
  model: TimelineCardModel;
};

function parseEntriesFromMarkdown(md: string): ParsedEntry[] {
  const lines = md.split("\n");
  const entries: ParsedEntry[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseTimelineLine(line);
    if (!parsed) continue;

    const time = parsed.timeText;
    const head = parsed.head;

    const bodyLines: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const next = lines[j];
      if (isTimelineLine(next)) break;
      if (next.match(/^##/)) break;

      if (next.trim() === "") {
        bodyLines.push("");
        j++;
        continue;
      }

      if (!/^(\s+|[-*+]\s)/.test(next)) break;

      bodyLines.push(next.replace(/^\s+/, ""));
      j++;
    }

    entries.push({
      lineStart: i,
      lineEnd: j - 1,
      model: createTimelineCardModel({ time, head, bodyLines }),
    });

    i = j - 1;
  }

  return entries;
}

function openExternalUrl(app: TemporalDriftPlugin["app"], url: string): void {
  const openWithDefaultApp = (app as any).openWithDefaultApp as ((targetUrl: string) => void) | undefined;
  if (openWithDefaultApp) {
    openWithDefaultApp(url);
    return;
  }

  window.open(url);
}

function renderCardDom(app: TemporalDriftPlugin["app"], file: TFile, entry: ParsedEntry): HTMLElement {
  const openLine = () => {
    void openAndJumpToLine(app, file, entry.lineStart);
  };

  const { root } = renderTimelineCardDom(entry.model, {
    entryAriaLabel: `Timeline entry ${entry.model.time}`,
    actions: {
      onTimeClick: openLine,
      onCardClick: openLine,
      onPrimaryClick: () => {
        void openWikiLinkFromCard(app, entry.model.primaryLinkTarget ?? "", file.path).then((opened) => {
          if (opened) return;
          openLine();
        });
      },
      onParticipantClick: (participant) => {
        void openWikiLinkFromCard(app, participant.target, file.path).then((opened) => {
          if (opened) return;
          openLine();
        });
      },
      onJoinClick: (url) => openExternalUrl(app, url),
    },
  });

  return root;
}

async function openAndJumpToLine(app: TemporalDriftPlugin["app"], file: TFile, line: number): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { active: true });

  const mdView = app.workspace.getActiveViewOfType(MarkdownView);
  if (!mdView) return;

  // If we are in reading view, flip back to source so cursor is meaningful.
  if (mdView.getMode() === "preview") {
    await (app as any).commands?.executeCommandById?.("markdown:toggle-preview");
  }

  mdView.editor.setCursor({ line, ch: 0 });
  mdView.editor.focus();
}

export function registerTimelinePostProcessor(plugin: TemporalDriftPlugin): void {
  // Cache parsed entries per file mtime.
  const cache = new Map<string, { mtime: number; entries: ParsedEntry[]; byStart: Map<number, ParsedEntry> }>();

  plugin.registerMarkdownPostProcessor(
    async (el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
      const sourcePath = ctx.sourcePath;
      if (!sourcePath) return;

      const normalizedPath = normalizePath(sourcePath);
      if (!pathInFolder(normalizedPath, plugin.settings.dailyNotesFolder, ["Daily notes"])) {
        return;
      }

      const af = plugin.app.vault.getAbstractFileByPath(sourcePath);
      if (!(af instanceof TFile)) return;

      const mtime = af.stat.mtime;
      let cached = cache.get(sourcePath);
      if (!cached || cached.mtime !== mtime) {
        const md = await plugin.app.vault.read(af);
        const entries = parseEntriesFromMarkdown(md);
        const byStart = new Map<number, ParsedEntry>();
        for (const e of entries) byStart.set(e.lineStart, e);
        cached = { mtime, entries, byStart };
        cache.set(sourcePath, cached);
      }

      if (cached.entries.length === 0) return;

      const ranges = cached.entries.map((e) => ({ start: e.lineStart, end: e.lineEnd }));

      const inAnyRange = (line: number): boolean => {
        for (const r of ranges) {
          if (line >= r.start && line <= r.end) return true;
        }
        return false;
      };

      // In preview mode, timeline entries may render inside list items.
      const candidates = Array.from(el.querySelectorAll("li, p"));
      const blocks = candidates.length > 0 ? candidates : Array.from(el.children);

      for (const child of blocks) {
        const info = ctx.getSectionInfo(child as HTMLElement);
        if (!info) continue;

        if (!inAnyRange(info.lineStart)) continue;

        const entry = cached.byStart.get(info.lineStart);
        if (entry) {
          const card = renderCardDom(plugin.app, af, entry);
          child.replaceWith(card);
        } else {
          // Part of timeline entry body; remove duplicate rendered lines.
          child.remove();
        }
      }
    },
    200
  );
}
