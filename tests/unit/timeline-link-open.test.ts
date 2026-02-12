import test from "node:test";
import assert from "node:assert/strict";
import { openWikiLinkFromCard } from "../../src/utils/timeline-link-open";

test("openWikiLinkFromCard opens wikilink targets via workspace leaf", async () => {
  const calls: Array<{ target: string; sourcePath: string }> = [];

  const app = {
    workspace: {
      getLeaf: (_newLeaf: boolean) => ({
        openLinkText: async (target: string, sourcePath: string) => {
          calls.push({ target, sourcePath });
        },
      }),
    },
  };

  const opened = await openWikiLinkFromCard(app, "People/Nick Stocks", "Daily notes/2026-02-12.md");

  assert.equal(opened, true);
  assert.deepEqual(calls, [
    { target: "People/Nick Stocks", sourcePath: "Daily notes/2026-02-12.md" },
  ]);
});

test("openWikiLinkFromCard returns false for empty targets", async () => {
  const app = {
    workspace: {
      getLeaf: () => ({
        openLinkText: async () => {
          throw new Error("should not be called");
        },
      }),
    },
  };

  const opened = await openWikiLinkFromCard(app, "", "Daily notes/2026-02-12.md");
  assert.equal(opened, false);
});
