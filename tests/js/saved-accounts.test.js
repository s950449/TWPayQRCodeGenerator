import test from "node:test";
import assert from "node:assert/strict";
import { createAccountRecord, requireConsent, normalizeLegacyAccounts } from "../../docs/js/saved-accounts.js";

test("account records retain a stable ID when display order changes", () => {
  const first = createAccountRecord({ id: "one", label: "甲", bankId: "004", account: "123" });
  const second = createAccountRecord({ id: "two", label: "乙", bankId: "005", account: "456" });
  assert.equal([second, first].find((item) => item.id === "one").account, "0000000000000123");
});

test("saving an account requires an explicit acknowledgement", () => {
  assert.throws(() => requireConsent(false), /同意/);
  assert.doesNotThrow(() => requireConsent(true));
});

test("records normalize account and reject invalid input", () => {
  assert.equal(createAccountRecord({ label: "x", bankId: "004", account: "123" }).account, "0000000000000123");
  assert.throws(() => createAccountRecord({ label: "x", bankId: "bad", account: "123" }));
});

test("legacy normalization requires an array", () => {
  assert.throws(() => normalizeLegacyAccounts({}), /格式/);
  assert.equal(normalizeLegacyAccounts([{ label: "x", bankId: "004", account: "123" }])[0].account, "0000000000000123");
});
