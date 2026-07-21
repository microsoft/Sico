import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../src/components/ui/table";

describe("Table", () => {
  it("renders a basic table structure", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Value</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Item</TableCell>
            <TableCell>123</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Name" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "Value" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Item" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "123" })).toBeInTheDocument();
  });

  describe("TableHeader", () => {
    it("carries no hover-neutralizing rule of its own", () => {
      // Header rows don't highlight because TableRow scopes its brand fills to
      // `[tbody_&]` (see the row-state tests), so the thead needs no counter-rule
      // like the old `[&_tr]:hover:bg-inherit`. Assert that legacy class is gone.
      render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
            </TableRow>
          </TableHeader>
        </Table>,
      );
      const thead = screen
        .getByRole("columnheader", { name: "Name" })
        .closest('[data-slot="table-header"]');
      expect(thead).not.toHaveClass("[&_tr]:hover:bg-inherit");
    });
  });

  describe("row state classes (scoped to body rows)", () => {
    function renderRow(): HTMLElement {
      render(
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>Cell</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
      return screen.getByRole("row");
    }

    it("hover → [tbody_&]:hover:bg-primary-50", () => {
      expect(renderRow()).toHaveClass("[tbody_&]:hover:bg-primary-50");
    });

    it("aria-expanded → [tbody_&]:has-aria-expanded:bg-primary-50", () => {
      expect(renderRow()).toHaveClass(
        "[tbody_&]:has-aria-expanded:bg-primary-50",
      );
    });

    it("selected → [tbody_&]:data-[state=selected]:bg-primary-50", () => {
      expect(renderRow()).toHaveClass(
        "[tbody_&]:data-[state=selected]:bg-primary-50",
      );
    });
  });
});
