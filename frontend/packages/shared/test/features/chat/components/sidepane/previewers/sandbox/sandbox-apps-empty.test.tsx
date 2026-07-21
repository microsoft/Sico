import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SandboxAppsEmpty } from "@/features/chat/components/sidepane/previewers/sandbox/sandbox-apps-empty";

describe("<SandboxAppsEmpty>", () => {
  it("renders the empty-state heading and body", () => {
    render(<SandboxAppsEmpty />);
    expect(
      screen.getByRole("heading", { name: "No apps installed" }),
    ).toBeVisible();
    expect(screen.getByText("Apps will appear here.")).toBeVisible();
  });

  it("renders the decorative illustration", () => {
    render(<SandboxAppsEmpty />);
    expect(
      screen.getByTestId("message-state-illustration"),
    ).toBeInTheDocument();
  });
});
