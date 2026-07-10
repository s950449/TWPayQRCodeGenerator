import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("payment page uses local executable assets and declares CSP", async () => {
  const html = await readFile("docs/index.html", "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.doesNotMatch(html, /https:\/\/cdn\.jsdelivr\.net|https:\/\/fonts\.googleapis\.com/);
  assert.match(html, /src="vendor\/papaparse-5\.4\.1\.min\.js"/);
});
