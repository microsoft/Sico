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

import type { Meta, StoryObj } from "@storybook/react-vite";
import { ArrowUpDownIcon, FolderIcon, PencilIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../src/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../src/components/ui/table";

const statusPillClasses = {
  green:
    "bg-status-success-fill text-status-success-foreground inline-flex h-6 items-center justify-center rounded-full px-2 py-1 text-xs font-medium tracking-wider whitespace-nowrap",
  red: "bg-danger-100 text-danger-800 inline-flex h-6 items-center justify-center rounded-full px-2 py-1 text-xs font-medium tracking-wider whitespace-nowrap",
  orange:
    "bg-status-warning-fill text-status-warning-foreground inline-flex h-6 items-center justify-center rounded-full px-2 py-1 text-xs font-medium tracking-wider whitespace-nowrap",
} as const;

function StatusPill({
  color,
  children,
}: {
  color: keyof typeof statusPillClasses;
  children: ReactNode;
}): React.ReactElement {
  return <span className={statusPillClasses[color]}>{children}</span>;
}

/* ============================================
   Meta
   ============================================ */

/**
 * Data table built on native HTML table elements with SICO design tokens.
 * Compose `Table` with `TableHeader`, `TableBody`, `TableRow`, `TableHead`,
 * and `TableCell`, then render whatever content each column needs inside the
 * cells.
 */
const meta = {
  title: "Components/Table",
  component: Table,
  parameters: { layout: "padded" },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

/* ============================================
   Stories
   ============================================ */

/**
 * Minimal composition — header plus a few body rows. Props spread onto the
 * `Table` element drive the Controls panel.
 */
export const Default: Story = {
  render: (args) => (
    <Table {...args}>
      <TableHeader>
        <TableRow className="h-10">
          <TableHead className="w-40">NAME</TableHead>
          <TableHead className="w-40">ROLE</TableHead>
          <TableHead className="text-right">DEVICES</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="text-foreground-primary">Patrick</TableCell>
          <TableCell className="text-foreground-primary">Product</TableCell>
          <TableCell className="text-foreground-primary text-right tabular-nums">
            2
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="text-foreground-primary">Omar</TableCell>
          <TableCell className="text-foreground-primary">Engineering</TableCell>
          <TableCell className="text-foreground-primary text-right tabular-nums">
            1
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="text-foreground-primary">Aisha</TableCell>
          <TableCell className="text-foreground-primary">Marketing</TableCell>
          <TableCell className="text-foreground-primary text-right tabular-nums">
            —
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  ),
};

/**
 * Click any row to select it. The selected row gets a `bg-primary-50`
 * highlight via the `data-state="selected"` attribute; rows also tint on
 * hover.
 */
export const WithSelection: Story = {
  render: () => <WithSelectionExample />,
};

/**
 * Right-aligned numeric columns. `tabular-nums` keeps digits vertically
 * aligned across rows.
 */
export const NumericColumns: Story = {
  render: () => <NumericColumnsExample />,
};

/* ============================================
   Example renderers
   ============================================ */

function WithSelectionExample(): React.ReactElement {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = [
    {
      id: "patrick-1",
      name: "Patrick",
      role: "Product",
      project: "Copilot",
      operator: null,
      devices: 2,
      status: "Pending" as const,
      time: "2025-11-14 14:45",
    },
    {
      id: "patrick-2",
      name: "Patrick",
      role: "Product",
      project: "Bing",
      operator: null,
      devices: 3,
      status: "Pending" as const,
      time: "2025-11-14 14:45",
    },
    {
      id: "omar",
      name: "Omar",
      role: "Engineering",
      project: "Edge",
      operator: "Luca Moretti",
      devices: 1,
      status: "Pending" as const,
      time: "2025-11-15 09:30",
    },
    {
      id: "luis",
      name: "Luis",
      role: "Analyst",
      project: "Project with no i...",
      operator: "Luca Moretti",
      devices: 1,
      status: "Passed" as const,
      time: "2025-11-13 11:00",
    },
    {
      id: "aisha-1",
      name: "Aisha",
      role: "Marketing",
      project: "Project with no i...",
      operator: "Luca Moretti",
      devices: null,
      status: "Rejected" as const,
      time: "2025-11-12 16:20",
    },
  ];

  const statusColorMap = {
    Pending: "orange",
    Passed: "green",
    Rejected: "red",
  } as const;

  return (
    <Table>
      <TableHeader>
        <TableRow className="h-10">
          <TableHead className="w-40">REQUEST FOR</TableHead>
          <TableHead className="w-40">PROJECT</TableHead>
          <TableHead className="w-40">OPERATOR</TableHead>
          <TableHead className="w-30">
            <span className="inline-flex items-center gap-1">
              DEVICES
              <Button
                variant="subtle"
                size="icon-xs"
                className="text-foreground-tertiary hover:text-foreground-primary hover:bg-transparent"
              >
                <ArrowUpDownIcon className="size-3.5" />
              </Button>
            </span>
          </TableHead>
          <TableHead className="w-30">
            <span className="inline-flex items-center gap-1">
              STATUS
              <Button
                variant="subtle"
                size="icon-xs"
                className="text-foreground-tertiary hover:text-foreground-primary hover:bg-transparent"
              >
                <ArrowUpDownIcon className="size-3.5" />
              </Button>
            </span>
          </TableHead>
          <TableHead className="pr-0">REQUEST TIME</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={row.id}
            data-state={selectedId === row.id ? "selected" : undefined}
            onClick={(): void => setSelectedId(row.id)}
            className="cursor-pointer"
          >
            <TableCell>
              <div className="flex flex-col">
                <span className="text-foreground-primary text-base font-medium">
                  {row.name}
                </span>
                <span className="text-foreground-tertiary text-xs">
                  {row.role}
                </span>
              </div>
            </TableCell>
            <TableCell>
              <span className="text-foreground-primary inline-flex min-w-0 items-center gap-2 text-base">
                <span className="text-icon-secondary flex shrink-0 [&_svg]:size-4">
                  <FolderIcon />
                </span>
                <span className="truncate">{row.project}</span>
              </span>
            </TableCell>
            <TableCell>
              {row.operator ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="text-foreground-primary text-base">
                    {row.operator}
                  </span>
                  <Button variant="subtle" size="icon-xs">
                    <PencilIcon className="size-3.5" />
                  </Button>
                </span>
              ) : (
                <Button variant="secondary" size="sm">
                  Assign
                </Button>
              )}
            </TableCell>
            <TableCell className="text-foreground-primary w-11 text-right tabular-nums">
              {row.devices ?? "—"}
            </TableCell>
            <TableCell>
              <StatusPill color={statusColorMap[row.status]}>
                {row.status}
              </StatusPill>
            </TableCell>
            <TableCell className="pr-0">
              <span className="text-foreground-primary text-base">
                {row.time}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function NumericColumnsExample(): React.ReactElement {
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-10">
          <TableHead>METRIC</TableHead>
          <TableHead className="text-right">
            <span className="relative inline-flex items-center">
              VALUE
              <Button
                variant="subtle"
                size="icon-xs"
                className="text-foreground-tertiary hover:text-foreground-primary absolute -right-6 hover:bg-transparent"
              >
                <ArrowUpDownIcon className="size-3.5" />
              </Button>
            </span>
          </TableHead>
          <TableHead className="text-right">
            <span className="relative inline-flex items-center">
              CHANGE
              <Button
                variant="subtle"
                size="icon-xs"
                className="text-foreground-tertiary hover:text-foreground-primary absolute -right-6 hover:bg-transparent"
              >
                <ArrowUpDownIcon className="size-3.5" />
              </Button>
            </span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell className="text-foreground-primary">
            Active sessions
          </TableCell>
          <TableCell className="text-foreground-primary text-right tabular-nums">
            1024
          </TableCell>
          <TableCell className="text-right tabular-nums">
            {/* eslint-disable-next-line tailwindcss/no-custom-classname -- SICO token */}
            <span className="text-pass-700">+12%</span>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="text-foreground-primary">
            Devices enrolled
          </TableCell>
          <TableCell className="text-foreground-primary text-right tabular-nums">
            256
          </TableCell>
          <TableCell className="text-right tabular-nums">
            <span className="text-danger-500">-3%</span>
          </TableCell>
        </TableRow>
        <TableRow>
          <TableCell className="text-foreground-primary">
            Completion rate
          </TableCell>
          <TableCell className="text-foreground-primary text-right tabular-nums">
            98.5%
          </TableCell>
          <TableCell className="text-foreground-tertiary text-right tabular-nums">
            0%
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}
