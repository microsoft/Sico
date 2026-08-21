import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Skeleton } from "../../../src/components/ui/skeleton";

describe("Skeleton", () => {
  it("renders as a div with the animate-skeleton class", () => {
    const { container } = render(<Skeleton data-testid="s" />);
    const el = container.querySelector("[data-testid='s']");
    expect(el).toBeInTheDocument();
    expect(el?.className).toContain("animate-skeleton");
  });

  it("forwards className", () => {
    const { container } = render(
      <Skeleton className="h-32 w-full" data-testid="s" />,
    );
    const el = container.querySelector("[data-testid='s']");
    expect(el?.className).toContain("h-32");
    expect(el?.className).toContain("w-full");
  });
});
