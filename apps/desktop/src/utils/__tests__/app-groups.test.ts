import { describe, expect, it } from "vitest";
import { ConfigDocument, DEFAULT_APP_GROUP_ID } from "@godgesture/shared";
import {
  moveAppToGroup,
  moveGroupBefore,
  removeCustomGroup,
} from "../app-groups";

const WORK_GROUP_ID = "80000000-0000-4000-8000-000000000001";

function documentWithGroups() {
  return ConfigDocument.parse({
    groups: [
      { id: DEFAULT_APP_GROUP_ID, name: "默认", order: 0 },
      { id: WORK_GROUP_ID, name: "工作", order: 1 },
    ],
    apps: [
      {
        id: "80000000-0000-4000-8000-000000000010",
        name: "Chrome",
        groupId: DEFAULT_APP_GROUP_ID,
        order: 0,
      },
      {
        id: "80000000-0000-4000-8000-000000000011",
        name: "VS Code",
        groupId: WORK_GROUP_ID,
        order: 4,
      },
    ],
  });
}

describe("application group mutations", () => {
  it("moves an app into the target group and normalizes both app orders", () => {
    const document = documentWithGroups();

    expect(
      moveAppToGroup(
        document.apps,
        document.groups,
        "80000000-0000-4000-8000-000000000010",
        WORK_GROUP_ID,
      ),
    ).toBe(true);

    expect(document.apps[0]).toMatchObject({
      groupId: WORK_GROUP_ID,
      order: 1,
    });
    expect(document.apps[1]).toMatchObject({
      groupId: WORK_GROUP_ID,
      order: 0,
    });
  });

  it("moves a group before another group and normalizes group orders", () => {
    const document = documentWithGroups();
    const extraGroupId = "80000000-0000-4000-8000-000000000002";
    document.groups.push({ id: extraGroupId, name: "娱乐", order: 2 });

    expect(moveGroupBefore(document.groups, extraGroupId, DEFAULT_APP_GROUP_ID)).toBe(true);
    expect(
      [...document.groups].sort((left, right) => left.order - right.order).map((group) => group.id),
    ).toEqual([extraGroupId, DEFAULT_APP_GROUP_ID, WORK_GROUP_ID]);
    expect(document.groups.map((group) => group.order).sort()).toEqual([0, 1, 2]);
  });

  it("moves apps to default when deleting a custom group and protects default", () => {
    const document = documentWithGroups();

    expect(removeCustomGroup(document.groups, document.apps, WORK_GROUP_ID)).toBe(true);
    expect(document.groups.map((group) => group.id)).toEqual([DEFAULT_APP_GROUP_ID]);
    expect(document.apps.every((app) => app.groupId === DEFAULT_APP_GROUP_ID)).toBe(true);
    expect(document.apps.map((app) => app.order).sort()).toEqual([0, 1]);
    expect(removeCustomGroup(document.groups, document.apps, DEFAULT_APP_GROUP_ID)).toBe(false);
  });
});
