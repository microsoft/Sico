import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CollapsiblePanelShell } from "@/features/projects/components/collapsible-panel-shell";

describe("CollapsiblePanelShell", () => {
  it("renders a titled region with its children", () => {
    render(
      <CollapsiblePanelShell title="Detail" onCollapse={vi.fn()}>
        <p>body content</p>
      </CollapsiblePanelShell>,
    );
    expect(screen.getByRole("region", { name: "Detail" })).toBeInTheDocument();
    expect(screen.getByText("body content")).toBeInTheDocument();
  });

  it("renders the actions slot", () => {
    render(
      <CollapsiblePanelShell
        title="Detail"
        onCollapse={vi.fn()}
        actions={<button type="button">act</button>}
      >
        <p>body</p>
      </CollapsiblePanelShell>,
    );
    expect(screen.getByRole("button", { name: "act" })).toBeInTheDocument();
  });

  it("fires onCollapse when the collapse button is clicked", async () => {
    const onCollapse = vi.fn();
    const user = userEvent.setup();
    render(
      <CollapsiblePanelShell title="Detail" onCollapse={onCollapse}>
        <p>body</p>
      </CollapsiblePanelShell>,
    );
    await user.click(screen.getByRole("button", { name: "Collapse panel" }));
    expect(onCollapse).toHaveBeenCalledOnce();
  });
});
