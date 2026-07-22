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
  DropdownMenuTrigger,
  toast,
} from "@sico/ui";
import { ChevronDown } from "lucide-react";
import { type ChangeEvent, type JSX, useRef } from "react";

import { type InstallScope } from "../../../../../sandbox/hooks/use-app-install-actions";

export type InstallAppButtonProps = {
  deviceCount: number;
  disabled?: boolean;
  // Fires with the chosen .apk file and the install scope. Single-device always
  // uses "current".
  onInstall: (file: File, scope: InstallScope) => void;
};

// "Install app" control for the manage-apps panel: opens a file picker for an
// .apk and emits the file + scope. With multiple devices it first offers a
// scope menu (this device / all devices); with one device it picks straight
// away. A non-.apk selection is rejected with a toast.
export function InstallAppButton({
  deviceCount,
  disabled = false,
  onInstall,
}: InstallAppButtonProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The scope chosen from the menu (or "current" for a lone device), read when
  // the file dialog resolves.
  const scopeRef = useRef<InstallScope>("current");
  const multiple = deviceCount > 1;

  const pickFile = (scope: InstallScope): void => {
    scopeRef.current = scope;
    fileInputRef.current?.click();
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const input = event.target;
    const file = input.files?.[0];
    // Reset so picking the same file again still fires `change`.
    input.value = "";
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith(".apk")) {
      toast.error("Please upload an .apk file.");
      return;
    }
    onInstall(file, scopeRef.current);
  };

  return (
    <>
      {multiple ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="primary" disabled={disabled} />}
          >
            Install app
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => pickFile("current")}>
              To this device
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => pickFile("all")}>
              {`To all Android devices (${deviceCount})`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="primary"
          disabled={disabled}
          onClick={() => pickFile("current")}
        >
          Install app
        </Button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept=".apk"
        className="hidden"
        onChange={onFileChange}
      />
    </>
  );
}
