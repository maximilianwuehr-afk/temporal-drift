import test from "node:test";
import assert from "node:assert/strict";
import { CalendarSyncStateService } from "../../src/services/calendar-sync-state";

type MemoryPlugin = {
  loadData: () => Promise<unknown>;
  saveData: (data: unknown) => Promise<void>;
  store: Record<string, unknown>;
};

function createApp(seed: Record<string, unknown> = {}): { app: unknown; plugin: MemoryPlugin } {
  const plugin: MemoryPlugin = {
    store: { ...seed },
    async loadData() {
      return { ...this.store };
    },
    async saveData(data: unknown) {
      this.store = (data as Record<string, unknown>) ?? {};
    },
  };

  const app = {
    plugins: {
      getPlugin: (id: string) => (id === "temporal-drift" ? plugin : null),
    },
  };

  return { app, plugin };
}

test("calendar sync state service builds stable keys", () => {
  const { app } = createApp();
  const svc = new CalendarSyncStateService(app as any);
  assert.equal(svc.makeKey("primary", "abc123"), "primary:abc123");
});

test("calendar sync state load normalizes malformed data", async () => {
  const { app } = createApp({
    calendarSync: {
      suppressedEventIds: {
        "primary:a": { deletedAt: 123, sourcePath: "Daily notes/2026-02-12.md", reason: "local-delete" },
        "bad:b": { foo: "bar" },
      },
      lastRemoteSnapshot: {
        "primary:a": { start: "2026-02-13T09:00:00Z", end: "2026-02-13T09:30:00Z", updated: "u1" },
        "bad:b": { start: "", end: "" },
      },
    },
  });

  const svc = new CalendarSyncStateService(app as any);
  const state = await svc.load();

  assert.equal(state.suppressedEventIds["primary:a"].deletedAt, 123);
  assert.ok(state.suppressedEventIds["bad:b"]);
  assert.equal(state.lastRemoteSnapshot["primary:a"].start, "2026-02-13T09:00:00Z");
  assert.equal(state.lastRemoteSnapshot["bad:b"], undefined);
});

test("calendar sync state save preserves non-calendar plugin keys", async () => {
  const { app, plugin } = createApp({
    dailyNotesFolder: "Daily notes",
    googleTasksEnabled: true,
  });

  const svc = new CalendarSyncStateService(app as any);
  await svc.save({
    suppressedEventIds: {
      "primary:x": { deletedAt: 111, reason: "manual" },
    },
    lastRemoteSnapshot: {},
  });

  const stored = plugin.store;
  assert.equal(stored.dailyNotesFolder, "Daily notes");
  assert.equal(stored.googleTasksEnabled, true);
  assert.ok((stored.calendarSync as any).suppressedEventIds["primary:x"]);
});
