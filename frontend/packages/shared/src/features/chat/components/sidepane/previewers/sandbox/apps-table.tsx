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

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@sico/ui";
import { Ellipsis, Trash2 } from "lucide-react";
import { type JSX } from "react";

import { SandboxAppsEmpty } from "./sandbox-apps-empty";
import appIconUrl from "../../../../../../assets/app-icon.svg";
import { type EmulatorApp } from "../../../../../sandbox/schemas/emulator-app";

export type AppsTableProps = {
  apps: EmulatorApp[];
  // True when more than one device is attached — enables the "for all devices"
  // uninstall option.
  hasMultipleDevices: boolean;
  // Signals intent to uninstall; the parent confirms + runs the mutation.
  onUninstall: (app: EmulatorApp, forAllDevices: boolean) => void;
};

// The installed-apps table for one device: Name / Version / a row overflow menu
// (Uninstall, plus "Uninstall for all devices" when multiple devices exist).
// Stateless — the confirm dialog and uninstall mutation live in the parent
// panel; this only surfaces the rows and emits intent.
export function AppsTable({
  apps,
  hasMultipleDevices,
  onUninstall,
}: AppsTableProps): JSX.Element {
  if (apps.length === 0) {
    return <SandboxAppsEmpty />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="text-sm">Name</TableHead>
          <TableHead className="text-sm">Version</TableHead>
          <TableHead className="text-right text-sm">Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {apps.map((app) => (
          <TableRow key={app.package} className="h-16">
            <TableCell className="font-medium">
              <span className="flex items-center gap-2">
                <img
                  data-testid="app-icon"
                  src={appIconUrl}
                  alt=""
                  className="size-8 shrink-0"
                />
                {app.appName}
              </span>
            </TableCell>
            <TableCell className="text-foreground-secondary">
              {app.version}
            </TableCell>
            <TableCell className="text-right">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="subtle"
                      size="icon-xs"
                      aria-label={`Actions for ${app.appName}`}
                    />
                  }
                >
                  <Ellipsis aria-hidden="true" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => onUninstall(app, false)}>
                    <Trash2 aria-hidden="true" />
                    Uninstall
                  </DropdownMenuItem>
                  {hasMultipleDevices ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => onUninstall(app, true)}>
                        <Trash2 aria-hidden="true" />
                        Uninstall for all devices
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
