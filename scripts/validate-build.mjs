import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const required = [
  "dist/manifest.json",
  "dist/popup.html",
  "dist/assets/content.js",
  "dist/assets/background.js",
  "dist/icons/icon-16.png",
  "dist/icons/icon-32.png",
  "dist/icons/icon-48.png",
  "dist/icons/icon-128.png",
];

await Promise.all(required.map((path) => access(resolve(root, path))));

const moduleSyntax = [
  /^\s*import\s/m,
  /[;}\n]\s*import\s+[*{a-zA-Z_$"']/,
  /\bimport\s*\(/,
  /\bimport\.meta\b/,
];

for (const bundle of ["dist/assets/content.js", "dist/assets/background.js"]) {
  const source = await readFile(resolve(root, bundle), "utf8");
  if (moduleSyntax.some((pattern) => pattern.test(source))) {
    throw new Error(`${bundle} must not contain ES module syntax (import / import() / import.meta)`);
  }
}
