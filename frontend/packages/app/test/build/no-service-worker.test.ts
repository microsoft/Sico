import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { distDir, listDistFiles } from "./dist-helpers";

// Basename-anchored: SW keyword starts the basename + only `.`/`-`/`.js`
// after. Avoids over-matching `swap.js`, `mysw.js`, `noworkbox.js`.
const swPattern = /^(sw|service-worker|workbox)(?:[-.][^/]*)?\.js$/;

describe("build artifact: no service worker", () => {
  it("dist contains no sw.js / service-worker.js / workbox-*", () => {
    const all = listDistFiles();
    expect(all.filter((f) => swPattern.test(path.basename(f)))).toEqual([]);
  });

  it("index.html does not call navigator.serviceWorker.register", () => {
    const idx = readFileSync(path.join(distDir, "index.html"), "utf8");
    expect(idx).not.toMatch(/serviceWorker\.register/);
  });
});
