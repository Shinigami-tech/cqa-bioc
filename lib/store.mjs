// Tiny JSON-file store. Swap for SQLite/Postgres later without changing the API in server.mjs.
import fs from "node:fs";
import path from "node:path";

const DIR = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(DIR, { recursive: true });
const file = (name) => path.join(DIR, `${name}.json`);

export function load(name, fallback) {
  try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch { return fallback; }
}
export function save(name, value) {
  const tmp = file(name) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
}
export const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
