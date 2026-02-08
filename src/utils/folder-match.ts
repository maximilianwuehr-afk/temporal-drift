function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function toPrefix(path: string): string {
  const normalized = normalizeVaultPath(path).replace(/\/+$/, "");
  return normalized.length === 0 ? "" : `${normalized}/`;
}

export function folderPrefixes(configuredFolder: string, aliases: string[] = []): string[] {
  const source = (configuredFolder || "").trim();
  const variants = new Set<string>();

  const add = (value: string) => {
    const prefix = toPrefix(value);
    if (prefix) variants.add(prefix);
  };

  add(source);
  if (source.includes("_")) add(source.replace(/_/g, " "));
  if (source.includes(" ")) add(source.replace(/\s+/g, "_"));
  for (const alias of aliases) add(alias);

  return [...variants];
}

export function pathInFolder(filePath: string, configuredFolder: string, aliases: string[] = []): boolean {
  const normalizedPath = normalizeVaultPath(filePath);
  const prefixes = folderPrefixes(configuredFolder, aliases);
  return prefixes.some((prefix) => normalizedPath.startsWith(prefix));
}
