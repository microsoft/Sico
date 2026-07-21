import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@sico/ui";
import { ArrowUp, Download, MoreHorizontal, Trash2 } from "lucide-react";
import type { ReactElement } from "react";

export function SkillActionsMenu({
  onReplace,
  onDownloadZip,
  onDelete,
}: {
  onReplace: () => void;
  onDownloadZip: () => void;
  onDelete: () => void;
}): ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="subtle" size="icon" aria-label="Actions" />}
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="shadow-l min-w-40 rounded-lg p-1"
      >
        <DropdownMenuItem onClick={onReplace}>
          <ArrowUp />
          Replace
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDownloadZip}>
          <Download />
          Download ZIP
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDelete}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
