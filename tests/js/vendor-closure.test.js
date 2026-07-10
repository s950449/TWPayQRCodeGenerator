import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vendorRoot = resolve(root, "docs/vendor");
const qrcodePath = resolve(vendorRoot, "qrcode-1.5.3.mjs");
const staticImportPattern = /\bimport(?:[\s\S]*?\bfrom\s*)?["']([^"']+)["']/g;

async function findVendorClosureIssues(entryPath) {
  const pending = [entryPath];
  const visited = new Set();
  const issues = [];

  while (pending.length > 0) {
    const currentPath = pending.pop();
    if (visited.has(currentPath)) continue;
    visited.add(currentPath);

    const source = await readFile(currentPath, "utf8");
    for (const match of source.matchAll(staticImportPattern)) {
      const specifier = match[1];
      if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
        issues.push(`${relative(vendorRoot, currentPath)} imports non-local ${specifier}`);
        continue;
      }

      const dependencyPath = resolve(dirname(currentPath), specifier);
      const vendorRelativePath = relative(vendorRoot, dependencyPath);
      if (vendorRelativePath === ".." || vendorRelativePath.startsWith(`..${sep}`)) {
        issues.push(`${relative(vendorRoot, currentPath)} escapes vendor root via ${specifier}`);
        continue;
      }

      try {
        await readFile(dependencyPath);
        pending.push(dependencyPath);
      } catch {
        issues.push(`${relative(vendorRoot, currentPath)} imports missing ${specifier}`);
      }
    }
  }

  return issues;
}

test("QRCode vendor graph contains only local relative modules", async () => {
  assert.deepEqual(await findVendorClosureIssues(qrcodePath), []);
});
