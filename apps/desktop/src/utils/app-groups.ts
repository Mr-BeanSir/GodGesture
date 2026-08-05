import {
  DEFAULT_APP_GROUP_ID,
  type AppEntry,
  type AppGroup,
} from "@godgesture/shared";

export { DEFAULT_APP_GROUP_ID };

function ordered<T extends { order: number }>(items: T[]): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => left.item.order - right.item.order || left.index - right.index)
    .map(({ item }) => item);
}

function normalizeOrders<T extends { order: number }>(items: T[]): void {
  ordered(items).forEach((item, index) => {
    item.order = index;
  });
}

export function moveAppToGroup(
  apps: AppEntry[],
  groups: AppGroup[],
  appId: string,
  targetGroupId: string,
): boolean {
  const app = apps.find((candidate) => candidate.id === appId);
  if (!app || !groups.some((group) => group.id === targetGroupId)) return false;
  if (app.groupId === targetGroupId) return false;

  const sourceGroupId = app.groupId;
  const targetApps = apps.filter(
    (candidate) => candidate.groupId === targetGroupId && candidate.id !== appId,
  );
  normalizeOrders(targetApps);
  app.groupId = targetGroupId;
  app.order = targetApps.length - 1;
  targetApps.push(app);
  normalizeOrders(apps.filter((candidate) => candidate.groupId === sourceGroupId));
  normalizeOrders(targetApps);
  return true;
}

export function moveGroupBefore(
  groups: AppGroup[],
  sourceGroupId: string,
  targetGroupId: string,
): boolean {
  if (sourceGroupId === targetGroupId) return false;
  if (
    !groups.some((group) => group.id === sourceGroupId) ||
    !groups.some((group) => group.id === targetGroupId)
  ) {
    return false;
  }

  const source = groups.find((group) => group.id === sourceGroupId)!;
  const remaining = ordered(groups.filter((group) => group.id !== sourceGroupId));
  const targetIndex = remaining.findIndex((group) => group.id === targetGroupId);
  if (targetIndex < 0) return false;
  remaining.splice(targetIndex, 0, source);
  remaining.forEach((group, index) => {
    group.order = index;
  });
  return true;
}

export function removeCustomGroup(
  groups: AppGroup[],
  apps: AppEntry[],
  groupId: string,
): boolean {
  if (groupId === DEFAULT_APP_GROUP_ID) return false;
  const index = groups.findIndex((group) => group.id === groupId);
  if (index < 0) return false;

  const defaultApps = apps.filter((app) => app.groupId === DEFAULT_APP_GROUP_ID);
  apps
    .filter((app) => app.groupId === groupId)
    .forEach((app) => {
      app.groupId = DEFAULT_APP_GROUP_ID;
      app.order = defaultApps.length;
      defaultApps.push(app);
    });
  groups.splice(index, 1);
  normalizeOrders(groups);
  normalizeOrders(defaultApps);
  return true;
}
