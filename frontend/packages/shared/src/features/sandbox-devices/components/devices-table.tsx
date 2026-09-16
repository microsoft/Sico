import { useLingui } from "@lingui/react/macro";
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

import { type Device } from "../../devices";
import {
  DEVICE_HEADER_KEYS,
  type DeviceHeaderCopy,
  useDeviceHeaderCopy,
} from "../hooks/use-device-header-copy";

function typeLabel(type: string, labels: Record<string, string>): string {
  return labels[type] ?? type;
}

function isAssigned(status: string): boolean {
  return status.toLowerCase() === "assigned";
}

type DevicesTableCopy = {
  headers: DeviceHeaderCopy;
  typeLabels: Record<string, string>;
  assigned: string;
  available: string;
  assign: string;
  reassign: string;
  assignDenied: string;
};

function useDevicesTableCopy(): DevicesTableCopy {
  const { t } = useLingui();
  const headers = useDeviceHeaderCopy();
  return {
    headers,
    typeLabels: {
      linux_workstation: t({
        id: "sandboxDevices.type.linuxWorkstation",
        message: "Linux Workstation",
      }),
      emulator: t({ id: "sandboxDevices.type.emulator", message: "Emulator" }),
      physical: t({ id: "sandboxDevices.type.physical", message: "Physical" }),
      wincua: "WinCUA",
    },
    assigned: t({ id: "sandboxDevices.status.assigned", message: "Assigned" }),
    available: t({
      id: "sandboxDevices.status.available",
      message: "Available",
    }),
    assign: t({ id: "sandboxDevices.action.assign", message: "Assign" }),
    reassign: t({ id: "sandboxDevices.action.reassign", message: "Reassign" }),
    assignDenied: t({
      id: "sandboxDevices.action.assignDenied",
      message: "Available to Owners and Admins only.",
    }),
  };
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
  const copy = useDevicesTableCopy();
  return (
    <Table>
      <TableHeader>
        <TableRow className="h-13 hover:bg-transparent">
          {DEVICE_HEADER_KEYS.map((key) => (
            <TableHead key={key} className="h-13 px-6 text-sm">
              {copy.headers[key]}
            </TableHead>
          ))}
          <TableHead className="h-13 px-6 text-sm">
            {copy.headers.status}
          </TableHead>
          <TableHead className="h-13 px-6 text-right text-sm">
            {copy.headers.actions}
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
                {typeLabel(device.type, copy.typeLabels)}
              </TableCell>
              <TableCell className="text-foreground-secondary px-6 text-sm">
                {device.instanceName || "—"}
              </TableCell>
              <TableCell className="px-6">
                <Badge color={assigned ? "blue" : "green"}>
                  {assigned ? copy.assigned : copy.available}
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
                    {assigned ? copy.reassign : copy.assign}
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
                          {assigned ? copy.reassign : copy.assign}
                        </Button>
                      }
                    />
                    <TooltipContent className="text-wrap">
                      {copy.assignDenied}
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
