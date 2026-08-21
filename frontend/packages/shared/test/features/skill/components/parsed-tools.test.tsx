import { render, screen } from "@testing-library/react";
import { describe, it, vi } from "vitest";

import { ParsedTools } from "@/features/skill/components/tools/parsed-tools";

describe("ParsedTools", () => {
  it("lists each parsed tool", () => {
    render(
      <ParsedTools
        actions={[
          {
            name: "vector search",
            description: "find docs",
            advancedSettings: "",
          },
          { name: "summarise", description: "tl;dr", advancedSettings: "" },
        ]}
        onActionChange={vi.fn()}
      />,
    );
    screen.getByText("vector search");
    screen.getByText("summarise");
  });

  it("shows an empty hint when there are no tools", () => {
    render(<ParsedTools actions={[]} onActionChange={vi.fn()} />);
    screen.getByText("No tools yet");
  });
});
