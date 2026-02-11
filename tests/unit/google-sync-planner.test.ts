import test from "node:test";
import assert from "node:assert/strict";

import { decideSyncPair } from "../../src/services/google-sync-planner";

test("sync planner: local create -> create remote", () => {
  const d = decideSyncPair({
    remoteExists: false,
    statesMatch: false,
    localModified: 100,
    remoteModified: 0,
    lastSynced: 0,
  });

  assert.equal(d.action, "create_remote");
  assert.equal(d.reason, "remote_missing");
  assert.equal(d.conflict, false);
});

test("sync planner: local update -> push remote", () => {
  const d = decideSyncPair({
    remoteExists: true,
    statesMatch: false,
    localModified: 200,
    remoteModified: 100,
    lastSynced: 150,
  });

  assert.equal(d.action, "push_local");
  assert.equal(d.reason, "local_changed");
  assert.equal(d.conflict, false);
});

test("sync planner: remote update -> pull local", () => {
  const d = decideSyncPair({
    remoteExists: true,
    statesMatch: false,
    localModified: 100,
    remoteModified: 220,
    lastSynced: 150,
  });

  assert.equal(d.action, "pull_remote");
  assert.equal(d.reason, "remote_changed");
  assert.equal(d.conflict, false);
});

test("sync planner: both changed -> local wins conflict", () => {
  const d = decideSyncPair({
    remoteExists: true,
    statesMatch: false,
    localModified: 300,
    remoteModified: 290,
    lastSynced: 200,
  });

  assert.equal(d.action, "push_local");
  assert.equal(d.reason, "both_changed_local_wins");
  assert.equal(d.conflict, true);
});

test("sync planner: both changed but equal -> noop conflict", () => {
  const d = decideSyncPair({
    remoteExists: true,
    statesMatch: true,
    localModified: 300,
    remoteModified: 290,
    lastSynced: 200,
  });

  assert.equal(d.action, "noop");
  assert.equal(d.reason, "both_changed_but_equal");
  assert.equal(d.conflict, true);
});

test("sync planner: idempotent steady state -> noop", () => {
  const d = decideSyncPair({
    remoteExists: true,
    statesMatch: true,
    localModified: 500,
    remoteModified: 500,
    lastSynced: 500,
  });

  assert.equal(d.action, "noop");
  assert.equal(d.reason, "no_change");
  assert.equal(d.conflict, false);
});

test("sync planner: local modified timestamp but already equal -> noop", () => {
  const d = decideSyncPair({
    remoteExists: true,
    statesMatch: true,
    localModified: 700,
    remoteModified: 600,
    lastSynced: 650,
  });

  assert.equal(d.action, "noop");
  assert.equal(d.reason, "local_changed_but_equal");
});

test("sync planner: drift without newer timestamp -> deterministic local push", () => {
  const d = decideSyncPair({
    remoteExists: true,
    statesMatch: false,
    localModified: 1000,
    remoteModified: 1000,
    lastSynced: 1200,
  });

  assert.equal(d.action, "push_local");
  assert.equal(d.reason, "state_drift_without_timestamp");
});
