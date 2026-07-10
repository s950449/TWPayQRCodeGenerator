import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CSV_BYTES, MAX_BATCH_ROWS, MAX_FIELD_CODEPOINTS, validateRows, sanitizeFilenameStem } from "../../docs/js/csv-limits.js";
test("CSV limits are exact", () => {
  assert.equal(MAX_CSV_BYTES, 5 * 1024 * 1024); assert.equal(MAX_BATCH_ROWS, 1000); assert.equal(MAX_FIELD_CODEPOINTS, 128);
  assert.throws(() => validateRows(Array.from({length: 1001}, () => ({}))));
  assert.throws(() => validateRows([{ Name: "😀".repeat(129) }]));
});
test("filename stems are safe", () => { assert.equal(sanitizeFilenameStem("a/b\n", "x"), "a_b_"); assert.equal(sanitizeFilenameStem("..", "x"), "x"); assert.equal(sanitizeFilenameStem("", "x"), "x"); });
