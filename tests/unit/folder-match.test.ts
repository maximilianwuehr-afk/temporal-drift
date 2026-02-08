import test from "node:test";
import assert from "node:assert/strict";
import { folderPrefixes, pathInFolder } from "../../src/utils/folder-match";

test("folderPrefixes includes underscore/space aliases", () => {
  const prefixes = folderPrefixes("Daily_notes");

  assert.ok(prefixes.includes("Daily_notes/"));
  assert.ok(prefixes.includes("Daily notes/"));
});

test("pathInFolder matches Daily_notes config to Daily notes files", () => {
  const configured = "Daily_notes";

  assert.equal(pathInFolder("Daily notes/2027-01-03.md", configured), true);
  assert.equal(pathInFolder("Daily_notes/2027-01-03.md", configured), true);
  assert.equal(pathInFolder("Tasks/Fix parser.md", configured), false);
});

test("pathInFolder honors explicit aliases", () => {
  assert.equal(pathInFolder("Team Notes/2027-01-03.md", "Daily_notes", ["Team Notes"]), true);
});
