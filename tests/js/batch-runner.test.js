import test from "node:test";
import assert from "node:assert/strict";
import { LatestOperation } from "../../docs/js/operation-controller.js";
import { runBatch } from "../../docs/js/batch-runner.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

test("superseded batch never reports completion or downloads", async () => {
  const operations = new LatestOperation();
  const first = operations.start();
  const gate = deferred();
  const events = [];
  const run = runBatch({
    id: first, rows: [{ id: "A" }], isCurrent: (id) => operations.isCurrent(id),
    processRow: async () => gate.promise,
    createArchive: async () => "archive-A",
    onProgress: () => events.push("progress"),
    onComplete: () => events.push("complete"),
    onError: () => events.push("error")
  });
  operations.start();
  gate.resolve();
  await run;
  assert.deepEqual(events, []);
});
