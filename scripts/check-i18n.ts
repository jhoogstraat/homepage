import { readdir, readFile } from "node:fs/promises";
import { deepStrictEqual } from "node:assert/strict";

function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(shape);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, shape(item)]));
  }
  return typeof value;
}

const files = (await readdir("i18n")).filter((file) => file.endsWith(".json"));
const base = shape(JSON.parse(await readFile("i18n/de.json", "utf8")));
for (const file of files) {
  deepStrictEqual(shape(JSON.parse(await readFile(`i18n/${file}`, "utf8"))), base, `${file} differs from de.json`);
}
console.log(`${files.length} translation files are in sync.`);
