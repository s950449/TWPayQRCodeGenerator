import test from "node:test";
import assert from "node:assert/strict";
import { createAccountRecord, requireConsent } from "../../docs/js/saved-accounts.js";

test("account records retain a stable ID when display order changes", () => {
  const first = createAccountRecord({ id: "one", label: "甲", bankId: "004", account: "123" });
  const second = createAccountRecord({ id: "two", label: "乙", bankId: "005", account: "456" });
  assert.equal([second, first].find((item) => item.id === "one").account, "123");
});

test("saving an account requires an explicit acknowledgement", () => {
  assert.throws(() => requireConsent(false), /同意/);
  assert.doesNotThrow(() => requireConsent(true));
});
