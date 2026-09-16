#!/usr/bin/env node

// Builds the work list for a translation pass: every empty target `msgstr`
// paired with its English source text, placeholders, and extracted comments.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PO = createRequire(require.resolve("@lingui/format-po"))("pofile");

const [, , sourcePath, targetPath, outPath] = process.argv;
if (!sourcePath || !targetPath || !outPath) {
  console.error(
    "Usage: node extract-untranslated.mjs <source.po> <target.po> <out.json>",
  );
  process.exit(1);
}

const source = PO.parse(readFileSync(sourcePath, "utf8"));
const target = PO.parse(readFileSync(targetPath, "utf8"));

const sourceMsg = new Map();
for (const item of source.items) {
  if (!item.obsolete && item.msgid) {
    sourceMsg.set(item.msgid, (item.msgstr || []).join(""));
  }
}

const work = [];
for (const item of target.items) {
  if (item.obsolete || !item.msgid) continue;
  if ((item.msgstr || []).join("") !== "") continue;
  const en = sourceMsg.get(item.msgid) ?? "";
  work.push({
    id: item.msgid,
    en,
    placeholders: en.match(/\{[^}]+\}/g) || [],
    hints: item.extractedComments || [],
  });
}

writeFileSync(outPath, JSON.stringify(work, null, 2), "utf8");
console.log(`Extracted ${work.length} untranslated entries -> ${outPath}`);
