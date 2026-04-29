import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "dist/manifest.json",
  "dist/popup.html",
  "dist/assets/content.js",
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const content = await readFile(resolve(root, "dist/assets/content.js"), "utf8");
if (/^\s*import\s/m.test(content)) {
  throw new Error("content script bundle must not contain static import statements");
}
