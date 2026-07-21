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
