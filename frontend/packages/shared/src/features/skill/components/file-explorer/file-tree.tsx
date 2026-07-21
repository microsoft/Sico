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
