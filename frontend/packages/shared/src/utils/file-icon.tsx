/* eslint-disable react/no-multi-comp -- thin stroke-pinning wrappers, not independent components */
import {
  IconFile,
  IconFileCode,
  IconFileDescription,
  IconTable,
  IconWorld,
} from "@tabler/icons-react";
import { type ComponentType, createElement, type JSX } from "react";

import { extensionOf, isUrl } from "./file-type";

// Filename → file-type icon. All tabler glyphs, each wrapped to pin stroke 1.5:
// tabler reads no provider, so a bare icon paints at its default stroke 2.
export type FileTypeIcon = ComponentType<{ className?: string }>;

function GenericFileIcon({ className }: { className?: string }): JSX.Element {
  return createElement(IconFile, { stroke: 1.5, className });
}

// Exported so the deliverable narrower's web-preview branch reuses the SAME
// website glyph (one source of truth — a change here can't drift the two render
// paths apart).
export function UrlIcon({ className }: { className?: string }): JSX.Element {
  return createElement(IconWorld, { stroke: 1.5, className });
}

function DocIcon({ className }: { className?: string }): JSX.Element {
  return createElement(IconFileDescription, { stroke: 1.5, className });
}

function CodeIcon({ className }: { className?: string }): JSX.Element {
  return createElement(IconFileCode, { stroke: 1.5, className });
}

function SpreadsheetIcon({ className }: { className?: string }): JSX.Element {
  return createElement(IconTable, { stroke: 1.5, className });
}

const ICON_BY_EXTENSION: Record<string, FileTypeIcon> = {
  pdf: GenericFileIcon,
  md: GenericFileIcon,
  txt: DocIcon,
  doc: DocIcon,
  docx: DocIcon,
  xls: SpreadsheetIcon,
  xlsx: SpreadsheetIcon,
  csv: SpreadsheetIcon,
  js: CodeIcon,
  ts: CodeIcon,
  json: CodeIcon,
  py: CodeIcon,
  html: UrlIcon,
  url: UrlIcon,
};

export function iconForFilename(filename: string): FileTypeIcon {
  if (isUrl(filename)) {
    return UrlIcon;
  }
  const ext = extensionOf(filename);
  // Own-property check, not a bare bracket-then-`?? File`: a filename ending in
  // an Object.prototype key (`x.__proto__`, `x.constructor`) would otherwise
  // resolve to the prototype value — a non-component that crashes createElement.
  return Object.hasOwn(ICON_BY_EXTENSION, ext)
    ? (ICON_BY_EXTENSION[ext] ?? GenericFileIcon)
    : GenericFileIcon;
}
