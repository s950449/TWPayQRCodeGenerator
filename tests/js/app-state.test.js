import test from "node:test";
import assert from "node:assert/strict";
import { LatestOperation } from "../../docs/js/operation-controller.js";
import { commitRenderedResult } from "../../docs/js/rendered-state.js";

test("stale requests cannot replace rendered download metadata", () => {
  const jobs = new LatestOperation();
  const first = jobs.start();
  const second = jobs.start();
  assert.equal(commitRenderedResult(jobs, first, { filename: "old.png" }), null);
  assert.deepEqual(commitRenderedResult(jobs, second, { filename: "new.png" }), { filename: "new.png" });
});
