import {
  Badge,
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@sico/ui";
import { cn } from "@sico/ui/lib/utils.ts";
import { type JSX } from "react";

import { type Device } from "../schemas/device";

// Shown on the disabled Assign button for a non-admin — the action stays
// visible (not hidden) so the capability is discoverable, greyed with a reason.
const ASSIGN_DENIED_TOOLTIP = "Available to Owners and Admins only.";

// Human-readable label per wire device-type key.
const TYPE_LABELS: Record<string, string> = {
  aio: "AIO",
  emulator: "Emulator",
  physical: "Physical",
  wincua: "WinCUA",
};

export const DEVICE_HEADERS = ["DEVICE", "TYPE", "ASSIGNED WORKER"] as const;

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

function isAssigned(status: string): boolean {
  return status.toLowerCase() === "assigned";
}

export type DevicesTableProps = {
  devices: Device[];
  // Gate the Assign action — only project admins may bind a device.
  canAssign: boolean;
  onAssign: (device: Device) => void;
};

// Sandbox device list: name (+status dot + badge), type, assigned worker,
// actions. Stateless — the assign dialog + mutation live in the page shell.
// Styling mirrors the members tables (PR313): uppercase `h-13 px-6` headers,
// `h-14` rows, a status dot before the name, and a filled status Badge.
export function DevicesTable({
  devices,
  canAssign,
  onAssign,
}: DevicesTableProps): JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-13 hover:bg-transparent">
          {DEVICE_HEADERS.map((label) => (
            <TableHead key={label} className="h-13 px-6 text-sm">
              {label}
            </TableHead>
          ))}
          <TableHead className="h-13 px-6 text-sm">STATUS</TableHead>
          <TableHead className="h-13 px-6 text-right text-sm">
            ACTIONS
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {devices.map((device) => {
          const assigned = isAssigned(device.status);
          return (
            <TableRow key={device.sandboxId} className="h-14">
              <TableCell className="text-foreground-primary px-6 font-medium">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      assigned
                        ? "bg-status-info-foreground"
                        : "bg-status-success-foreground",
                    )}
                  />
                  {device.displayName || device.sandboxId}
                </span>
              </TableCell>
              <TableCell className="text-foreground-secondary px-6 text-sm">
                {typeLabel(device.type)}
              </TableCell>
              <TableCell className="text-foreground-secondary px-6 text-sm">
                {device.instanceName || "—"}
              </TableCell>
              <TableCell className="px-6">
                <Badge color={assigned ? "blue" : "green"}>
                  {assigned ? "Assigned" : "Available"}
                </Badge>
              </TableCell>
              <TableCell className="px-6 text-right">
                {canAssign ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="min-w-24"
                    onClick={() => onAssign(device)}
                  >
                    {assigned ? "Reassign" : "Assign"}
                  </Button>
                ) : (
                  // Kept visible but disabled (aria-disabled, not native, so the
                  // tooltip trigger still receives hover) with a reason, so a
                  // non-admin discovers the action rather than seeing a blank.
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-disabled
                          className="min-w-24 opacity-50"
                          onClick={(event) => event.preventDefault()}
                        >
                          {assigned ? "Reassign" : "Assign"}
                        </Button>
                      }
                    />
                    <TooltipContent className="text-wrap">
                      {ASSIGN_DENIED_TOOLTIP}
                    </TooltipContent>
                  </Tooltip>
                )}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
