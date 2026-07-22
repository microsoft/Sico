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
} from "@sico/ui";
import { ChevronDown } from "lucide-react";
import type { ReactElement } from "react";

import type { SkillVersion } from "../../schemas/skill";
import { findActiveVersion } from "../../utils";

// Absolute local `MM-DD HH:mm` over native Intl (legacy moment(createdAt)
// format), no date library.
const versionDateFormat = new Intl.DateTimeFormat("en-GB", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function formatVersionDate(epochMs: number): string {
  const parts = versionDateFormat.formatToParts(new Date(epochMs));
  const at = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${at("month")}-${at("day")} ${at("hour")}:${at("minute")}`;
}

export function VersionDropdown({
  versions,
  selectedVersion,
  onSelect,
}: {
  versions: SkillVersion[];
  selectedVersion: string;
  onSelect: (version: string) => void;
}): ReactElement {
  const active = findActiveVersion(versions, selectedVersion);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="subtle" size="sm" aria-label="Version" />}
      >
        {active ? formatVersionDate(active.createdAt) : selectedVersion}
        <ChevronDown />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {versions.map((version) => (
          <DropdownMenuItem
            key={version.id}
            onClick={() => onSelect(version.version)}
          >
            {formatVersionDate(version.createdAt)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
