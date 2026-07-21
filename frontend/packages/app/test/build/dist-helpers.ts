import { readdirSync } from "node:fs";
import path from "node:path";

export const distDir = path.resolve(import.meta.dirname, "../../dist");
export const listDistFiles = (): string[] =>
  readdirSync(distDir, { recursive: true, encoding: "utf8" });
