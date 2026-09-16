#!/usr/bin/env node
// translate.mjs
//
// Non-interactive translation pass for CI: fills every empty `msgstr` in a
// target catalog by calling an Azure OpenAI Responses API deployment. Orchestrates the
// two deterministic scripts that already own PO parsing —
// `extract-untranslated.mjs` builds the work list and `apply-translations.mjs`
// writes the results back (and fails the run on dropped placeholders). This
// script only owns the model call in between.
//
// Usage:
//   node scripts/i18n/translate.mjs [targetLocale]      # default: zh-CN
//
// Required env:
//   AZURE_OPENAI_ENDPOINT     https://<resource>.services.ai.azure.com/openai/v1
//   AZURE_OPENAI_API_KEY      key for the resource
// Optional env:
//   AZURE_OPENAI_DEPLOYMENT   deployment name (default: gpt-5-mini)
//
// Exits 0 with no work done when the catalog is already complete.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const PO = createRequire(require.resolve("@lingui/format-po"))("pofile");

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const TMP = `${ROOT}/.tmp`;

const LOCALE = process.argv[2] || "zh-CN";
const SOURCE_PO = `${ROOT}/packages/shared/src/locales/en/messages.po`;
const TARGET_PO = `${ROOT}/packages/shared/src/locales/${LOCALE}/messages.po`;

const ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT?.replace(/\/+$/, "");
const API_KEY = process.env.AZURE_OPENAI_API_KEY;
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-5-mini";

const BATCH_SIZE = 25;
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 3;

// --- work list ------------------------------------------------------------

mkdirSync(TMP, { recursive: true });
const workPath = `${TMP}/i18n-work-${LOCALE}.json`;
const transPath = `${TMP}/i18n-translations-${LOCALE}.json`;

execFileSync(
  process.execPath,
  [`${SCRIPT_DIR}/extract-untranslated.mjs`, SOURCE_PO, TARGET_PO, workPath],
  { stdio: "inherit" },
);

const work = JSON.parse(readFileSync(workPath, "utf8"));
if (work.length === 0) {
  console.log(`${LOCALE}: catalog already complete, nothing to translate.`);
  rmSync(workPath, { force: true });
  process.exit(0);
}

if (!ENDPOINT || !API_KEY) {
  console.error(
    "Missing AZURE_OPENAI_ENDPOINT or AZURE_OPENAI_API_KEY in the environment.",
  );
  process.exit(1);
}

if (!ENDPOINT.endsWith("/openai/v1")) {
  console.error("AZURE_OPENAI_ENDPOINT must end with /openai/v1.");
  process.exit(1);
}

// Entries already translated in the catalog are the strongest consistency
// signal available — feed a sample back to the model as a working vocabulary.
const target = PO.parse(readFileSync(TARGET_PO, "utf8"));
const source = PO.parse(readFileSync(SOURCE_PO, "utf8"));
const sourceMsg = new Map(
  source.items
    .filter((it) => !it.obsolete && it.msgid)
    .map((it) => [it.msgid, (it.msgstr || []).join("")]),
);
const vocabulary = target.items
  .filter((it) => !it.obsolete && it.msgid && (it.msgstr || []).join("") !== "")
  .slice(0, 80)
  .map((it) => `${sourceMsg.get(it.msgid) ?? it.msgid} → ${it.msgstr.join("")}`)
  .join("\n");

const glossary = readFileSync(`${SCRIPT_DIR}/glossary.md`, "utf8");

const SYSTEM_PROMPT = [
  `You translate UI strings for the SICO product from English into ${LOCALE}.`,
  "Follow this glossary exactly — tone, terminology, punctuation, spacing:",
  "",
  glossary,
  vocabulary
    ? `\nExisting approved translations, match their style:\n${vocabulary}`
    : "",
  "",
  "Rules:",
  "- Copy every {placeholder} token verbatim, including its braces and casing.",
  "- Translate the value only. Never translate or alter the id.",
  '- Respond with a JSON object shaped { "<id>": "<translation>" } covering',
  "  every id you were given, and nothing else.",
].join("\n");

// --- model call -----------------------------------------------------------

const url = `${ENDPOINT}/responses`;

function translationSchema(batch) {
  return {
    type: "object",
    properties: Object.fromEntries(
      batch.map(({ id }) => [id, { type: "string" }]),
    ),
    required: batch.map(({ id }) => id),
    additionalProperties: false,
  };
}

function outputText(response) {
  return (
    response.output_text ??
    response.output
      ?.flatMap((item) => item.content || [])
      .find((content) => content.type === "output_text")?.text
  );
}

async function translateBatch(batch, index) {
  const payload = batch.map(({ id, en, hints }) => ({
    id,
    en,
    ...(hints.length > 0 ? { hints } : {}),
  }));

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "api-key": API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: DEPLOYMENT,
        input: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(payload) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "translations",
            strict: true,
            schema: translationSchema(batch),
          },
        },
        max_output_tokens: 8000,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      if (attempt === MAX_ATTEMPTS) {
        throw new Error(`batch ${index}: ${res.status} ${body.slice(0, 400)}`);
      }
      // 429 and 5xx are worth waiting out; anything else fails fast.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`batch ${index}: ${res.status} ${body.slice(0, 400)}`);
      }
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }

    const data = await res.json();
    const content = outputText(data);
    if (!content) throw new Error(`batch ${index}: empty completion`);
    return JSON.parse(content);
  }
  throw new Error(`batch ${index}: exhausted retries`);
}

const batches = [];
for (let i = 0; i < work.length; i += BATCH_SIZE) {
  batches.push(work.slice(i, i + BATCH_SIZE));
}

console.log(
  `Translating ${work.length} entries in ${batches.length} batches (deployment: ${DEPLOYMENT})…`,
);

const translations = {};
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, batches.length) }, async () => {
    while (cursor < batches.length) {
      const index = cursor++;
      const result = await translateBatch(batches[index], index);
      Object.assign(translations, result);
      console.log(`  batch ${index + 1}/${batches.length} done`);
    }
  }),
);

// --- apply ----------------------------------------------------------------

const missing = work.filter(
  ({ id }) => translations[id] == null || translations[id] === "",
);
if (missing.length > 0) {
  console.error(
    `Model returned no translation for ${missing.length} id(s):\n` +
      missing
        .slice(0, 20)
        .map(({ id }) => `  ${id}`)
        .join("\n"),
  );
  process.exit(1);
}

writeFileSync(transPath, JSON.stringify(translations, null, 2), "utf8");

execFileSync(
  process.execPath,
  [`${SCRIPT_DIR}/apply-translations.mjs`, TARGET_PO, transPath, SOURCE_PO],
  { stdio: "inherit" },
);

rmSync(workPath, { force: true });
rmSync(transPath, { force: true });
