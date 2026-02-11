export type SyncPairAction = "create_remote" | "push_local" | "pull_remote" | "noop";

export interface SyncPairDecision {
  action: SyncPairAction;
  conflict: boolean;
  reason:
    | "remote_missing"
    | "both_changed_local_wins"
    | "both_changed_but_equal"
    | "local_changed"
    | "local_changed_but_equal"
    | "remote_changed"
    | "remote_changed_but_equal"
    | "no_change"
    | "state_drift_without_timestamp";
}

export interface SyncPairInput {
  remoteExists: boolean;
  statesMatch: boolean;
  localModified: number;
  remoteModified: number;
  lastSynced: number;
}

function asMs(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Deterministic sync planning for one local<->remote task pair.
 * Keeps conflict behavior explicit and idempotent-friendly.
 */
export function decideSyncPair(input: SyncPairInput): SyncPairDecision {
  if (!input.remoteExists) {
    return {
      action: "create_remote",
      conflict: false,
      reason: "remote_missing",
    };
  }

  const lastSynced = asMs(input.lastSynced);
  const localModified = asMs(input.localModified);
  const remoteModified = asMs(input.remoteModified);

  const localChanged = localModified > lastSynced;
  const remoteChanged = remoteModified > lastSynced;

  if (localChanged && remoteChanged) {
    if (input.statesMatch) {
      return {
        action: "noop",
        conflict: true,
        reason: "both_changed_but_equal",
      };
    }

    return {
      action: "push_local",
      conflict: true,
      reason: "both_changed_local_wins",
    };
  }

  if (localChanged) {
    return {
      action: input.statesMatch ? "noop" : "push_local",
      conflict: false,
      reason: input.statesMatch ? "local_changed_but_equal" : "local_changed",
    };
  }

  if (remoteChanged) {
    return {
      action: input.statesMatch ? "noop" : "pull_remote",
      conflict: false,
      reason: input.statesMatch ? "remote_changed_but_equal" : "remote_changed",
    };
  }

  if (input.statesMatch) {
    return {
      action: "noop",
      conflict: false,
      reason: "no_change",
    };
  }

  // Rare clock-skew/path-drift case: no side looks newer, but payload differs.
  // Keep local authoritative for deterministic recovery.
  return {
    action: "push_local",
    conflict: false,
    reason: "state_drift_without_timestamp",
  };
}
