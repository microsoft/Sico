import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTrigger,
} from "@/components/ui/popover";

function TestPopover(): React.JSX.Element {
  return (
    <Popover>
      <PopoverTrigger>Open</PopoverTrigger>
      <PopoverContent>
        <PopoverHeader>
          <div>Popover header</div>
        </PopoverHeader>
        <div>Popover content</div>
      </PopoverContent>
    </Popover>
  );
}

describe("Popover", () => {
  describe("trigger", () => {
    it("renders trigger with correct role", (): void => {
      render(<TestPopover />);
      expect(screen.getByRole("button", { name: /open/i })).toBeInTheDocument();
    });
  });

  describe("PopoverContent", () => {
    it("reveals content with the SICO surface token when opened", async (): Promise<void> => {
      const user = userEvent.setup();
      render(
        <Popover>
          <PopoverTrigger>Open</PopoverTrigger>
          <PopoverContent data-testid="content">
            <div>Body</div>
          </PopoverContent>
        </Popover>,
      );
      await user.click(screen.getByRole("button", { name: /open/i }));
      expect(await screen.findByTestId("content")).toHaveClass(
        "bg-surface-basic",
      );
    });
  });
});
