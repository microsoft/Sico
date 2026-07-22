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
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
} from "lucide-react";
import { type ReactElement, useState } from "react";

export type TreeNode = {
  name: string;
  path: string;
  isFile: boolean;
  children: TreeNode[];
};

export function FileTreeItem({
  node,
  depth,
  selectedPath,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  selectedPath: string;
  onSelect: (path: string) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(true);
  const active = node.isFile && node.path === selectedPath;
  const indent = { paddingLeft: 8 + depth * 16 };

  if (node.isFile) {
    return (
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        aria-current={active}
        style={indent}
        className="group text-foreground-secondary hover:bg-surface-sunken aria-[current=true]:bg-surface-sunken aria-[current=true]:text-foreground-emphasis flex min-w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-left text-sm"
      >
        <FileIcon className="text-foreground-secondary group-aria-[current=true]:text-foreground-emphasis size-4 shrink-0" />
        <span className="whitespace-nowrap">{node.name}</span>
      </button>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        style={indent}
        className="text-foreground-secondary hover:bg-surface-sunken flex min-w-full items-center gap-1 rounded-lg py-1.5 pr-2 text-left text-sm"
      >
        {expanded ? (
          <ChevronDown className="text-foreground-tertiary size-4 shrink-0" />
        ) : (
          <ChevronRight className="text-foreground-tertiary size-4 shrink-0" />
        )}
        <Folder className="text-foreground-tertiary size-4 shrink-0" />
        <span className="whitespace-nowrap">{node.name}</span>
      </button>
      {expanded &&
        node.children.map((child) => (
          <FileTreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}
