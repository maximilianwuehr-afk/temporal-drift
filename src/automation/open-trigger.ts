// ============================================================================
// Remote open trigger (file-based)
//
// Purpose: allow reliable remote opening of notes without UI automation.
// Writes are done by any external process; the plugin watches a control file
// inside the vault and opens the referenced note.
//
// Control file (default): `<vault>/.obsidian/temporal-drift-open.txt`
// Content: a single vault-relative path, e.g. `Daily notes/2027-01-01.md`
// ============================================================================

import { App, Notice, TAbstractFile, TFile, normalizePath } from "obsidian";

export interface OpenTriggerOptions {
  controlPath: string; // vault-relative
}

export function registerOpenTrigger(app: App, opts: OpenTriggerOptions): void {
  const controlPath = normalizePath(opts.controlPath);

  const tryOpen = async (pathRaw: string): Promise<void> => {
    const decoded = pathRaw.trim();
    if (!decoded) return;

    const candidates = [
      normalizePath(decoded),
      normalizePath(decoded.endsWith(".md") ? decoded : decoded + ".md"),
    ];

    let file: TFile | null = null;

    for (const p of candidates) {
      const af = app.vault.getAbstractFileByPath(p);
      if (af instanceof TFile) {
        file = af;
        break;
      }
    }

    if (!file) {
      // Fallback: basename search (useful when the path in the trigger is partial)
      const base = normalizePath(decoded).split("/").pop() || decoded;
      const baseMd = base.endsWith(".md") ? base : base + ".md";
      file = app.vault.getMarkdownFiles().find((f) => f.path.endsWith("/" + baseMd) || f.path === baseMd) || null;
    }

    if (!file) {
      new Notice(`Temporal Drift: open-trigger file not found: ${decoded}`);
      return;
    }

    const leaf = app.workspace.getLeaf(true);
    await leaf.openFile(file, { active: true });
    app.workspace.setActiveLeaf(leaf, { focus: true });
  };

  // Ensure the control file exists (and its parent folder)
  app.workspace.onLayoutReady(async () => {
    const existing = app.vault.getAbstractFileByPath(controlPath);
    if (existing) return;

    const parts = controlPath.split("/");
    if (parts.length > 1) {
      const folder = parts.slice(0, -1).join("/");
      if (!app.vault.getAbstractFileByPath(folder)) {
        try {
          await app.vault.createFolder(folder);
        } catch {
          // ignore
        }
      }
    }

    try {
      await app.vault.create(controlPath, "");
    } catch {
      // ignore
    }
  });

  // Watch for modifications
  app.vault.on("modify", async (file: TAbstractFile) => {
    if (!(file instanceof TFile)) return;
    if (normalizePath(file.path) !== controlPath) return;

    const content = await app.vault.read(file);
    // first non-empty line wins
    const line = content.split(/\r?\n/).find((l) => l.trim().length > 0) || "";

    // Visual confirmation that the trigger fired (useful for remote debugging)
    new Notice(`TD open-trigger: ${line || "(empty)"}`);

    await tryOpen(line);
  });
}
