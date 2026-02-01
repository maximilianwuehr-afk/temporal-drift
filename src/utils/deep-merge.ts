// ============================================================================
// Deep Merge Utility
// ============================================================================

type DeepMergeable = Record<string, unknown>;

function isObject(item: unknown): item is DeepMergeable {
  return Boolean(item && typeof item === "object" && !Array.isArray(item));
}

export function deepMerge<T extends DeepMergeable>(target: T, source: Partial<T> | undefined): T {
  if (!source) return target;

  const output = { ...target };
  const sourceObj = source as DeepMergeable;

  for (const key of Object.keys(sourceObj)) {
    const targetValue = output[key as keyof T];
    const sourceValue = sourceObj[key];

    if (isObject(targetValue) && isObject(sourceValue)) {
      (output as DeepMergeable)[key] = deepMerge(
        targetValue as DeepMergeable,
        sourceValue as DeepMergeable
      );
    } else if (sourceValue !== undefined) {
      (output as DeepMergeable)[key] = sourceValue;
    }
  }

  return output;
}
