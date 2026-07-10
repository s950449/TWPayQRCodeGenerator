import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "docs/vendor/manifest.json"), "utf8"));
for (const asset of manifest.assets) {
  const path = resolve(root, asset.path);
  const actual = createHash("sha256").update(await readFile(path)).digest("hex");
  if (actual !== asset.sha256) throw new Error(`${asset.path} hash mismatch`);
}
console.log(`verified ${manifest.assets.length} vendor assets`);
