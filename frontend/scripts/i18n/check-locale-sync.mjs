#!/usr/bin/env node

// Fails when a source-locale `msgstr` was edited in place without the matching
// non-source locales being updated in the same change. That drift is invisible
// to every other check: `lingui extract` only sees added/removed ids, and its
// `Missing 0` only asserts `msgstr` is non-empty — never that it still matches
// the English. See .claude/rules/i18n.md (rename the id when meaning changes).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import config from "../../lingui.config.cjs";

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: frontendRoot,
  encoding: "utf8",
}).trim();
const { locales, sourceLocale, catalogs } = config;
const baseRef = process.argv[2] ?? "HEAD";
const targetLocales = locales.filter((locale) => locale !== sourceLocale);

// The sync check reads a single catalog template; a second entry would be
// silently ignored, giving false-green results — assert the invariant instead.
if (catalogs.length !== 1) {
  console.error(
    `i18n:check expects exactly one catalog in lingui.config.cjs, found ${catalogs.length}.`,
  );
  process.exit(1);
}

function catalogPath(locale) {
  return (
    catalogs[0].path.replace("<rootDir>/", "").replace("{locale}", locale) +
    ".po"
  );
}

function catalogGitPath(path) {
  return relative(repositoryRoot, resolve(frontendRoot, path)).replaceAll(
    "\\",
    "/",
  );
}

function readAt(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${catalogGitPath(path)}`], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
  } catch {
    return ""; // catalog didn't exist at the base ref — every id reads as new
  }
}

function readWorking(path) {
  try {
    return readFileSync(resolve(frontendRoot, path), "utf8");
  } catch {
    return "";
  }
}

// Minimal .po reader: msgid/msgstr plus their continuation lines, obsolete
// (`#~`) blocks dropped since a renamed id's leftovers aren't live copy.
function parsePo(source) {
  const entries = new Map();
  let id = null;
  let field = null;
  const buffer = { msgid: "", msgstr: "" };
  const flush = () => {
    if (id) {
      entries.set(id, buffer.msgstr);
    }
    id = null;
    field = null;
    buffer.msgid = "";
    buffer.msgstr = "";
  };
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (text === "" || text.startsWith("#~")) {
      flush();
      continue;
    }
    if (text.startsWith("#")) {
      continue;
    }
    const head = /^(msgid|msgstr)\s+"([\s\S]*)"$/.exec(text);
    if (head) {
      field = head[1];
      buffer[field] = head[2];
      if (field === "msgstr") {
        id = buffer.msgid;
      }
      continue;
    }
    const cont = /^"([\s\S]*)"$/.exec(text);
    if (cont && field) {
      buffer[field] += cont[1];
      if (field === "msgstr") {
        id = buffer.msgid;
      }
    }
  }
  flush();
  entries.delete("");
  return entries;
}

function diffCatalog(locale) {
  const path = catalogPath(locale);
  return {
    locale,
    before: parsePo(readAt(baseRef, path)),
    after: parsePo(readWorking(path)),
    path,
  };
}

const source = diffCatalog(sourceLocale);
// An id absent from the base is a genuine addition — extract + `Missing 0`
// already cover those. Only in-place rewrites of an existing id are silent.
const rewritten = [...source.after].filter(
  ([id, msgstr]) => source.before.has(id) && source.before.get(id) !== msgstr,
);

const problems = [];
// Parse each target locale's before/after once — the check is
// O(rewritten × locales) comparisons, but each catalog is read + parsed a
// single time rather than per reworded id.
const targets = targetLocales.map((locale) => diffCatalog(locale));
for (const [id, msgstr] of rewritten) {
  for (const target of targets) {
    if (target.after.get(id) === target.before.get(id)) {
      problems.push({
        id,
        locale: target.locale,
        english: msgstr,
        path: target.path,
      });
    }
  }
}

if (problems.length === 0) {
  console.log(
    `i18n:check — ${rewritten.length} reworded id(s), all locales in sync.`,
  );
  process.exit(0);
}

console.error(
  `i18n:check failed — ${problems.length} source string(s) reworded without updating every locale:\n`,
);
for (const { id, locale, english, path } of problems) {
  console.error(`  ${id}`);
  console.error(`    ${sourceLocale} → "${english}"`);
  console.error(`    ${locale} unchanged in ${path}\n`);
}
console.error(
  "Fix by either:\n" +
    "  • rename the id when the meaning changed, drop the obsolete #~ block, translate the new id; or\n" +
    "  • update the msgstr in every locale when it is a pure typo fix.\n" +
    "Then run: pnpm i18n:extract && pnpm i18n:compile\n" +
    "See .claude/rules/i18n.md",
);
process.exit(1);
