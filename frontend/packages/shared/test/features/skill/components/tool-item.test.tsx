import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ToolItem } from "@/features/skill/components/tools/tool-item";

describe("ToolItem", () => {
  it("renders the tool name and, once expanded, its editable fields", () => {
    render(
      <ToolItem
        action={{
          name: "vector search",
          description: "find docs",
          advancedSettings: "",
        }}
        defaultExpanded
        onChange={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: /vector search/i });
    expect(screen.getByPlaceholderText("Enter tool name")).toHaveValue(
      "vector search",
    );
    expect(
      screen.getByPlaceholderText("Describe what this tool does"),
    ).toHaveValue("find docs");
  });

  it("patches the action when a field changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ToolItem
        action={{ name: "search", description: "", advancedSettings: "" }}
        defaultExpanded
        onChange={onChange}
      />,
    );
    await user.type(screen.getByPlaceholderText("Enter tool name"), "!");
    expect(onChange).toHaveBeenCalledWith({
      name: "search!",
      description: "",
      advancedSettings: "",
    });
  });
});
