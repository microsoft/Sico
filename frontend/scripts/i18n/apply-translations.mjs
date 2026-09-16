#!/usr/bin/env node

// Writes translations to matching target `msgstr` entries after validating
// that every source placeholder remains present.

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PO = createRequire(require.resolve("@lingui/format-po"))("pofile");

const [, , targetPath, transPath, sourcePath] = process.argv;
if (!targetPath || !transPath) {
  console.error(
    "Usage: node apply-translations.mjs <target.po> <translations.json> [source.po]",
  );
  process.exit(1);
}

const translations = JSON.parse(
  readFileSync(transPath, "utf8").replace(/^\uFEFF/, ""),
);
const target = PO.parse(readFileSync(targetPath, "utf8"));

const sourceMsg = new Map();
if (sourcePath) {
  const source = PO.parse(readFileSync(sourcePath, "utf8"));
  for (const item of source.items) {
    if (!item.obsolete) {
      sourceMsg.set(item.msgid, (item.msgstr || []).join(""));
    }
  }
}

let applied = 0;
const warnings = [];
for (const item of target.items) {
  if (item.obsolete || !item.msgid) continue;
  const translation = translations[item.msgid];
  if (translation == null || translation === "") continue;

  if (sourcePath) {
    const sourceText = sourceMsg.get(item.msgid) ?? "";
    const required = sourceText.match(/\{[^}]+\}/g) || [];
    const actual = new Set(translation.match(/\{[^}]+\}/g) || []);
    for (const token of required) {
      if (!actual.has(token)) {
        warnings.push(`[${item.msgid}] missing placeholder ${token}`);
      }
    }
  }

  item.msgstr = [translation];
  applied++;
}

if (warnings.length > 0) {
  console.error(`Placeholder validation failed (${warnings.length}):`);
  console.error(warnings.join("\n"));
  process.exit(2);
}

writeFileSync(targetPath, target.toString(), "utf8");
console.log(`Applied ${applied} translations -> ${targetPath}`);
