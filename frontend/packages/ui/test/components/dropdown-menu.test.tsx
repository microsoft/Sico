/**
 * Copyright (c) 2026 Sico Authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ─── Helper ─────────────────────────────────────────────────── */

async function openMenu(jsx: React.ReactElement): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(jsx);
  await user.click(screen.getByRole("button", { name: /open/i }));
  return screen.findByRole("menu");
}

/* ─── Tests ──────────────────────────────────────────────────── */

describe("DropdownMenu", () => {
  it("hides the menu by default", () => {
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the menu on trigger click", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });
});

describe("DropdownMenuContent", () => {
  it("renders surface classes on the popup", async () => {
    const menu = await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(menu).toHaveClass(
      "border-divider",
      "bg-surface-basic",
      "text-foreground-primary",
      "rounded-lg",
      "border",
    );
  });

  it("merges user className onto the popup", async () => {
    const menu = await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent className="w-96">
          <DropdownMenuItem>A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(menu).toHaveClass("w-96", "bg-surface-basic");
  });
});

describe("DropdownMenuItem variants", () => {
  it("variant=default → data-variant=default + text-foreground-secondary", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitem");
    expect(item).toHaveAttribute("data-variant", "default");
    expect(item).toHaveClass("text-foreground-secondary");
  });

  it("variant=destructive → data-variant=destructive + destructive token classes", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem variant="destructive">Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitem", { name: /delete/i });
    expect(item).toHaveAttribute("data-variant", "destructive");
    expect(item).toHaveClass(
      "data-[variant=destructive]:text-button-destructive-foreground-rest",
      "data-[variant=destructive]:focus:bg-button-destructive-fill-hover",
    );
  });
});

describe("DropdownMenuItem state classes", () => {
  it("applies focus/active SICO token classes on default variant", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitem", { name: /a/i });
    expect(item).toHaveClass(
      "focus:bg-accent",
      "focus:text-accent-foreground",
      "active:bg-surface-sunken",
      "active:text-foreground-emphasis",
    );
  });

  it("disabled → data-disabled attr + opacity/pointer-events utilities", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem disabled>Disabled</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitem", { name: /disabled/i });
    expect(item).toHaveAttribute("data-disabled");
    expect(item).toHaveClass(
      "data-disabled:pointer-events-none",
      "data-disabled:opacity-50",
    );
  });
});

describe("inset prop", () => {
  it("DropdownMenuItem inset=true → data-inset=true + data-inset:pl-7", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem inset>A</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitem", { name: /a/i });
    expect(item).toHaveAttribute("data-inset", "true");
    expect(item).toHaveClass("data-inset:pl-7");
  });

  it("DropdownMenuLabel inset=true → data-inset=true + data-inset:pl-7", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel inset>Section</DropdownMenuLabel>
            <DropdownMenuItem>A</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const label = screen.getByText("Section");
    expect(label).toHaveAttribute("data-inset", "true");
    expect(label).toHaveClass("data-inset:pl-7");
  });

  it("DropdownMenuCheckboxItem inset=true → data-inset=true + data-inset:pl-7", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem inset>A</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemcheckbox");
    expect(item).toHaveAttribute("data-inset", "true");
    expect(item).toHaveClass("data-inset:pl-7");
  });

  it("DropdownMenuRadioItem inset=true → data-inset=true + data-inset:pl-7", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a" inset>
              A
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemradio");
    expect(item).toHaveAttribute("data-inset", "true");
    expect(item).toHaveClass("data-inset:pl-7");
  });

  it("DropdownMenuSubTrigger inset=true → data-inset=true + data-inset:pl-7", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger inset>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const subTrigger = screen.getByRole("menuitem", { name: /more/i });
    expect(subTrigger).toHaveAttribute("data-inset", "true");
    expect(subTrigger).toHaveClass("data-inset:pl-7");
  });
});

describe("DropdownMenuLabel", () => {
  it("renders base typography classes", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuGroup>
            <DropdownMenuLabel>Section</DropdownMenuLabel>
            <DropdownMenuItem>A</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const label = screen.getByText("Section");
    expect(label).toHaveClass(
      "text-foreground-tertiary",
      "px-3",
      "py-2",
      "text-xs",
      "font-medium",
    );
  });
});

describe("DropdownMenuSeparator", () => {
  it("renders divider classes", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>A</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>B</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const sep = screen.getByRole("separator");
    expect(sep).toHaveClass(
      "border-divider",
      "-mx-1",
      "my-1",
      "h-px",
      "border-t",
    );
  });
});

describe("DropdownMenuShortcut", () => {
  it("renders trailing-shortcut classes", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>
            Save
            <DropdownMenuShortcut>⌘S</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const shortcut = screen.getByText("⌘S");
    expect(shortcut).toHaveClass(
      "text-foreground-tertiary",
      "ml-auto",
      "text-xs",
      "tracking-widest",
    );
  });
});

describe("DropdownMenuCheckboxItem", () => {
  it("renders the indicator slot", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>Show bar</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemcheckbox", { name: /show bar/i });
    expect(
      item.querySelector("[data-slot='dropdown-menu-checkbox-item-indicator']"),
    ).toBeInTheDocument();
  });

  it("reflects checked=true via aria-checked", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem checked>Show bar</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(
      screen.getByRole("menuitemcheckbox", { name: /show bar/i }),
    ).toHaveAttribute("aria-checked", "true");
  });

  it("disabled → data-disabled:pointer-events-none + data-disabled:opacity-50", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuCheckboxItem disabled>Show bar</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemcheckbox", { name: /show bar/i });
    expect(item).toHaveClass(
      "data-disabled:pointer-events-none",
      "data-disabled:opacity-50",
    );
  });
});

describe("DropdownMenuRadioItem", () => {
  it("renders the indicator slot", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">A</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemradio", { name: /a/i });
    expect(
      item.querySelector("[data-slot='dropdown-menu-radio-item-indicator']"),
    ).toBeInTheDocument();
  });

  it("reflects selected value via aria-checked", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">A</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="b">B</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    expect(screen.getByRole("menuitemradio", { name: /^a$/i })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: /^b$/i })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("disabled → data-disabled:pointer-events-none + data-disabled:opacity-50", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a" disabled>
              A
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitemradio", { name: /a/i });
    expect(item).toHaveClass(
      "data-disabled:pointer-events-none",
      "data-disabled:opacity-50",
    );
  });
});

describe("DropdownMenuSubTrigger", () => {
  it("renders a trailing chevron icon", async () => {
    await openMenu(
      <DropdownMenu>
        <DropdownMenuTrigger>Open</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem>Sub</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const subTrigger = screen.getByRole("menuitem", { name: /more/i });
    expect(subTrigger.querySelector("svg")).toBeInTheDocument();
  });
});
