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

import { type ReactElement, useMemo } from "react";

import { FileTreeItem, type TreeNode } from "./file-tree-item";
import type { SkillFile } from "../../schemas/skill";

function buildTree(files: SkillFile[]): TreeNode[] {
  const root: TreeNode[] = [];
  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    let level = root;
    for (const [index, segment] of segments.entries()) {
      const isFile = index === segments.length - 1;
      const currentPath = segments.slice(0, index + 1).join("/");
      let node = level.find((n) => n.name === segment && n.isFile === isFile);
      if (!node) {
        node = { name: segment, path: currentPath, isFile, children: [] };
        level.push(node);
      }
      level = node.children;
    }
  }
  return root;
}

export function FileTree({
  files,
  selectedPath,
  onSelect,
}: {
  files: SkillFile[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
}): ReactElement {
  const tree = useMemo(() => buildTree(files), [files]);
  return (
    <div className="min-w-full space-y-0.5 px-2.5 py-1">
      {tree.map((node) => (
        <FileTreeItem
          key={node.path}
          node={node}
          depth={0}
          selectedPath={selectedPath ?? ""}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}
