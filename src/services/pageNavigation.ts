import { navigationItems, type PageId } from "@/pages/pageMeta";

export function getPageIdByNavigationIndex(index: number): PageId | undefined {
  if (index < 1 || index > navigationItems.length) {
    return undefined;
  }
  return navigationItems[index - 1]?.id;
}

export function getNavigationIndex(pageId: PageId) {
  const index = navigationItems.findIndex((item) => item.id === pageId);
  return index === -1 ? undefined : index + 1;
}

export function getAdjacentPageId(pageId: PageId, direction: -1 | 1): PageId {
  const index = navigationItems.findIndex((item) => item.id === pageId);
  if (index === -1) {
    return navigationItems[0]!.id;
  }

  const nextIndex = (index + direction + navigationItems.length) % navigationItems.length;
  return navigationItems[nextIndex]!.id;
}
