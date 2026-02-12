type LinkLeaf = {
  openLinkText: (target: string, sourcePath: string) => unknown;
};

type LinkWorkspace = {
  getLeaf: (newLeaf: boolean) => LinkLeaf | null | undefined;
};

export type LinkOpenApp = {
  workspace?: LinkWorkspace | null;
} | null | undefined;

export async function openWikiLinkFromCard(
  app: LinkOpenApp,
  target: string,
  sourcePath: string
): Promise<boolean> {
  const cleanTarget = target.trim();
  if (!cleanTarget) return false;

  const leaf = app?.workspace?.getLeaf(false);
  if (!leaf?.openLinkText) return false;

  await Promise.resolve(leaf.openLinkText(cleanTarget, sourcePath));
  return true;
}
