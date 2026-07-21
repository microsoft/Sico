import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/components/ui/input-group";

describe("InputGroup", () => {
  it("renders with role=group", (): void => {
    render(
      <InputGroup>
        <InputGroupInput placeholder="Search" />
      </InputGroup>,
    );
    expect(screen.getByRole("group")).toBeInTheDocument();
  });

  it("renders with data-slot=input-group", (): void => {
    render(
      <InputGroup>
        <InputGroupInput placeholder="Search" />
      </InputGroup>,
    );
    expect(screen.getByRole("group")).toHaveAttribute(
      "data-slot",
      "input-group",
    );
  });

  it("declares the focus-visible has() selector on the shell", (): void => {
    // Smoke check that the shell carries the keyboard-focus selector. The
    // actual visual outcome is owned by Tailwind/CSS — we only verify the
    // contract that the class is present so the :has() selector can fire.
    render(
      <InputGroup>
        <InputGroupInput placeholder="Search" />
      </InputGroup>,
    );
    expect(screen.getByRole("group")).toHaveClass(
      "has-[[data-slot=input-group-control]:focus-visible]:border-input-stroke-pressed",
    );
  });

  it("forwards aria-invalid to the control", (): void => {
    // Behavioral check — the shell's :has() selector reacts to the control's
    // `aria-invalid` attribute. What matters is the attribute landing on the
    // DOM so assistive tech announces the error.
    render(
      <InputGroup>
        <InputGroupInput aria-invalid="true" placeholder="Email" />
      </InputGroup>,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("merges custom className", (): void => {
    render(
      <InputGroup className="mt-4">
        <InputGroupInput />
      </InputGroup>,
    );
    expect(screen.getByRole("group")).toHaveClass("mt-4");
  });
});

describe("InputGroupInput", () => {
  it("renders with data-slot=input-group-control", (): void => {
    render(
      <InputGroup>
        <InputGroupInput placeholder="Search" />
      </InputGroup>,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "data-slot",
      "input-group-control",
    );
  });

  it("strips the standalone Input border", (): void => {
    render(
      <InputGroup>
        <InputGroupInput placeholder="Search" />
      </InputGroup>,
    );
    expect(screen.getByRole("textbox")).toHaveClass("border-0");
  });
});

describe("InputGroupTextarea", () => {
  it("renders with data-slot=input-group-control", (): void => {
    render(
      <InputGroup>
        <InputGroupTextarea placeholder="Bio" />
      </InputGroup>,
    );
    expect(screen.getByRole("textbox")).toHaveAttribute(
      "data-slot",
      "input-group-control",
    );
  });

  it("strips the standalone Textarea border", (): void => {
    render(
      <InputGroup>
        <InputGroupTextarea placeholder="Bio" />
      </InputGroup>,
    );
    expect(screen.getByRole("textbox")).toHaveClass("border-0");
  });
});

describe("InputGroupAddon", () => {
  it("renders with role=group", (): void => {
    render(
      <InputGroup>
        <InputGroupAddon>
          <span>@</span>
        </InputGroupAddon>
        <InputGroupInput />
      </InputGroup>,
    );
    // Two role=group elements: the InputGroup shell and the addon.
    expect(screen.getAllByRole("group")).toHaveLength(2);
  });

  it("defaults to inline-start alignment", (): void => {
    render(
      <InputGroup>
        <InputGroupAddon data-testid="addon">
          <span>@</span>
        </InputGroupAddon>
        <InputGroupInput />
      </InputGroup>,
    );
    expect(screen.getByTestId("addon")).toHaveAttribute(
      "data-align",
      "inline-start",
    );
    expect(screen.getByTestId("addon")).toHaveClass("order-first", "pl-2");
  });

  it("applies inline-end alignment", (): void => {
    render(
      <InputGroup>
        <InputGroupInput />
        <InputGroupAddon align="inline-end" data-testid="addon">
          <span>$</span>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByTestId("addon")).toHaveAttribute(
      "data-align",
      "inline-end",
    );
    expect(screen.getByTestId("addon")).toHaveClass("order-last", "pr-2");
  });

  it("applies block-start alignment for textarea header", (): void => {
    render(
      <InputGroup>
        <InputGroupAddon align="block-start" data-testid="addon">
          <span>Header</span>
        </InputGroupAddon>
        <InputGroupTextarea />
      </InputGroup>,
    );
    expect(screen.getByTestId("addon")).toHaveAttribute(
      "data-align",
      "block-start",
    );
    expect(screen.getByTestId("addon")).toHaveClass(
      "order-first",
      "w-full",
      "justify-start",
      "px-2.5",
      "pt-2",
    );
  });

  it("applies block-end alignment for textarea footer", (): void => {
    render(
      <InputGroup>
        <InputGroupTextarea />
        <InputGroupAddon align="block-end" data-testid="addon">
          <span>0/200</span>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByTestId("addon")).toHaveAttribute(
      "data-align",
      "block-end",
    );
    expect(screen.getByTestId("addon")).toHaveClass(
      "order-last",
      "w-full",
      "justify-start",
      "px-2.5",
      "pb-2",
    );
  });
});

describe("InputGroupButton", () => {
  it("renders as a button", (): void => {
    render(
      <InputGroup>
        <InputGroupInput />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="clear">×</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByRole("button", { name: /clear/i })).toBeInTheDocument();
  });

  it("fires onClick when clicked", async (): Promise<void> => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <InputGroup>
        <InputGroupInput />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="clear" onClick={onClick}>
            ×
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to xs size", (): void => {
    render(
      <InputGroup>
        <InputGroupInput />
        <InputGroupAddon align="inline-end">
          <InputGroupButton aria-label="clear">×</InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "xs");
    expect(screen.getByRole("button")).toHaveClass(
      "h-6",
      "gap-1",
      "rounded-md",
      "px-1.5",
    );
  });

  it("applies sm size", (): void => {
    // The `sm` cva variant intentionally contributes no extra classes —
    // <Button size="sm"> already covers the sizing. We assert the data-size
    // hook (used by storybook controls + e2e selectors) lands on the DOM.
    render(
      <InputGroup>
        <InputGroupInput />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="sm" aria-label="submit">
            Submit
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByRole("button", { name: /submit/i })).toHaveAttribute(
      "data-size",
      "sm",
    );
  });

  it("applies icon-xs size", (): void => {
    render(
      <InputGroup>
        <InputGroupInput />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="clear">
            ×
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "icon-xs");
    expect(screen.getByRole("button")).toHaveClass(
      "size-6",
      "rounded-md",
      "p-0",
    );
  });

  it("applies icon-sm size", (): void => {
    render(
      <InputGroup>
        <InputGroupInput />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-sm" aria-label="clear">
            ×
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
    );
    expect(screen.getByRole("button")).toHaveAttribute("data-size", "icon-sm");
    expect(screen.getByRole("button")).toHaveClass("size-8", "p-0");
  });
});

describe("InputGroupText", () => {
  it("renders as span", (): void => {
    render(
      <InputGroup>
        <InputGroupAddon>
          <InputGroupText>USD</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput />
      </InputGroup>,
    );
    expect(screen.getByText("USD").tagName).toBe("SPAN");
  });
});
