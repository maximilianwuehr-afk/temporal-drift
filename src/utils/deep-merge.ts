// ============================================================================
// Deep Merge Utility
// ============================================================================

function isObject(item: unknown): item is Record<string, unknown> {
  return Boolean(item && typeof item === "object" && !Array.isArray(item));
}

export function deepMerge<T>(target: T, source: Partial<T> | undefined): T {
  if (!source) return target;

  const output = { ...target } as Record<string, unknown>;
  const sourceObj = source as Record<string, unknown>;

  for (const key of Object.keys(sourceObj)) {
    const targetValue = output[key];
    const sourceValue = sourceObj[key];

    if (isObject(targetValue) && isObject(sourceValue)) {
      output[key] = deepMerge(targetValue, sourceValue);
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue;
    }
  }

  return output as T;
}
