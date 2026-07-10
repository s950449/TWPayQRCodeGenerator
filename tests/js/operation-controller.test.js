import test from "node:test";
import assert from "node:assert/strict";
import { LatestOperation } from "../../docs/js/operation-controller.js";

test("invalidated operation cannot become current after a newer operation begins", () => {
  const operations = new LatestOperation();
  const first = operations.start();
  operations.invalidate();
  const second = operations.start();
  assert.equal(operations.isCurrent(first), false);
  assert.equal(operations.isCurrent(second), true);
});
