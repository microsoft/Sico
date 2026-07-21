import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { VersionDropdown } from "@/features/skill/components/skill-list/version-dropdown";
import type { SkillVersion } from "@/features/skill/schemas/skill";

const versions = [
  {
    id: 1,
    skillId: 1,
    version: "v1",
    name: "S",
    description: "",
    assetId: 1,
    url: "",
    creatorUsername: "",
    failReason: "",
    createdAt: 1,
    updatedAt: 2,
    files: [],
    actions: [],
  },
  {
    id: 2,
    skillId: 1,
    version: "v2",
    name: "S",
    description: "",
    assetId: 2,
    url: "",
    creatorUsername: "",
    failReason: "",
    createdAt: 1,
    updatedAt: 2,
    files: [],
    actions: [],
  },
] satisfies SkillVersion[];

describe("VersionDropdown", () => {
  it("reports the selected version", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <VersionDropdown
        versions={versions}
        selectedVersion="v1"
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Version" }));
    // Menu items render the formatted createdAt date (not the version label),
    // so select by position: index 1 corresponds to versions[1] (v2).
    const items = await screen.findAllByRole("menuitem");
    const secondItem = items.at(1);
    if (!secondItem) {
      throw new Error("expected a menu item for the second version");
    }
    await user.click(secondItem);
    expect(onSelect).toHaveBeenCalledWith("v2");
  });
});
