import test from "node:test";
import assert from "node:assert/strict";
import {
  TwqrpValidationError,
  encodeTransfer,
  parseTransferPayload,
  twqrpBillEncode,
  TWQRP_FEE_LIST
} from "../../docs/js/twqrp.js";

test("encodes the maximum exact amount without Number rounding", () => {
  const result = encodeTransfer({ bankId: "004", account: "123", amount: "9999999999999999", memo: "" });
  assert.match(result.payload, /&D1=999999999999999900&D9=$/);
  assert.deepEqual(parseTransferPayload(result.payload), {
    bankId: "004",
    account: "0000000000000123",
    amount: "9999999999999999",
    memo: ""
  });
});

for (const [label, input] of [
  ["field injection in memo", { bankId: "004", account: "123", amount: null, memo: "&D1=100" }],
  ["field injection in account", { bankId: "004", account: "123&D1=100", amount: null, memo: "" }],
  ["partial numeric amount", { bankId: "004", account: "123", amount: "12abc", memo: "" }],
  ["seventeen-digit account", { bankId: "004", account: "12345678901234567", amount: null, memo: "" }]
]) {
  test(`rejects ${label}`, () => {
    assert.throws(() => encodeTransfer(input), TwqrpValidationError);
  });
}

test("keeps special bill URLs safe after validating an alphanumeric account", () => {
  const fee = TWQRP_FEE_LIST.find((item) => item.spec === "Water");
  assert.match(twqrpBillEncode(fee, "AB12CD34EF5", "10", ""), /^https:\/\/www\.water\.gov\.tw\//);
  assert.throws(() => twqrpBillEncode(fee, "AB12& D1", "10", ""), TwqrpValidationError);
});

test("rejects unsafe bill account and payload fields", () => {
  const fee = TWQRP_FEE_LIST.find((item) => item.spec === "Water");
  assert.throws(() => twqrpBillEncode(fee, " AB12 ", "10", ""), TwqrpValidationError);
  for (const value of ["X=1", "D9=&D9=", "D1=100000000000000000000", "D9=%26"]) {
    assert.throws(
      () => parseTransferPayload(`TWQRP://004NTTransfer/158/02/V1?D6=0000000000000123&D5=004&D10=901&${value}`),
      TwqrpValidationError
    );
  }
});

test("round trips canonical transfer payload", () => {
  const payload = encodeTransfer({ bankId: "004", account: "123", amount: "10", memo: "hello" }).payload;
  assert.deepEqual(parseTransferPayload(payload), {
    bankId: "004",
    account: "0000000000000123",
    amount: "10",
    memo: "hello"
  });
});
