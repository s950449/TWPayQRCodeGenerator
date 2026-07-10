# Payment QR Security and Concurrency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make both QR generators safe against payment-field injection and unsafe I/O, eliminate confirmed stale-state races, and add deterministic automated and browser verification.

**Architecture:** Keep the static site and Python CLI. Extract pure encoders, operation ownership, saved-account persistence, and Python validation/I/O helpers so the DOM and CLI entry points are thin adapters. Use Node's built-in test runner and Python `unittest`; no front-end framework or test dependency is added.

**Tech Stack:** Vanilla browser ESM, IndexedDB, BroadcastChannel, Node `node:test`, Python 3.11+ standard library, Requests, QRCode/Pillow, GitHub Actions.

## Global Constraints

- Python generation is offline by default; only `--online` may send payment metadata to `https://i-tw.org/twpay/api`.
- Transfer accounts are 1–16 ASCII digits; bill accounts are 1–64 ASCII alphanumeric characters.
- Amounts are canonical positive decimal strings in `1..9999999999999999`; JavaScript must not use `parseInt` or Number arithmetic for them.
- Memo is at most 19 Unicode code points and rejects controls plus `&`, `=`, `?`, `#`, and `%`.
- Browser and CLI CSV limits are 5 MiB, 1,000 rows, and 128 code points per field.
- Persisting full saved accounts requires explicit user acknowledgement; use IndexedDB UUID keys and BroadcastChannel notification.
- Do not leave a valid-looking partial BIC CSV or PNG visible during publication.
- Do not add runtime network dependencies to the payment page; vendored assets must be pinned, licensed, and hash-verified.
- Every behavior change starts with a test that fails for the intended reason, then receives the smallest implementation that makes it pass.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `docs/js/twqrp.js` | Pure ESM payment validation, canonical transfer/bill encoding, and transfer payload parsing. |
| `docs/js/operation-controller.js` | Monotonic operation IDs used to reject stale callbacks. |
| `docs/js/batch-runner.js` | Iterative, ownership-aware batch orchestration independent of the DOM. |
| `docs/js/saved-accounts.js` | IndexedDB account repository, UUID records, consent and cross-tab notification. |
| `docs/js/app.js` | Browser adapter: form state, temporary canvases, DOM updates, and user messages. |
| `docs/index.html`, `docs/css/style.css` | Consent/clear controls, local assets, and CSP-compatible styling. |
| `docs/vendor/` | Locally vendored QRCode, PapaParse, JSZip, FileSaver, licenses, and manifest. |
| `scripts/verify-vendor-assets.js` | Checks vendored filenames, versions, and SHA-256 values against the manifest. |
| `twpay_core.py` | Python transfer validation, canonical payload construction, parsing, and online-response comparison. |
| `twpay_io.py` | Safe output-stem validation, reservation, and atomic PNG publication. |
| `twpay_bic.py` | BIC CSV parsing, bounded download, lock acquisition, and atomic normalized publication. |
| `app.py` | CLI argument parsing, CSV orchestration, online opt-in, and image generation. |
| `update_bic.py` | Thin CLI wrapper around `twpay_bic.update_bic_dataset`. |
| `tests/js/*.test.js` | Deterministic JavaScript unit tests. |
| `tests/python/test_*.py` | Python `unittest` regression tests. |
| `package.json` | Node ESM and test scripts only; no npm dependencies. |
| `.github/workflows/test.yml` | Python, Node, dependency-audit, and vendor-integrity gates. |

## Task 1: Establish JavaScript test entry point and canonical encoder contract

**Files:**
- Create: `package.json`
- Create: `tests/js/twqrp.test.js`
- Modify: `docs/js/twqrp.js`
- Modify: `docs/index.html:129-130`

**Interfaces:**
- Produces: `TwqrpValidationError`, `validateTransfer`, `encodeTransfer`, `parseTransferPayload`, `twqrpBillEncode`, and `TWQRP_FEE_LIST` as ESM exports.
- Consumes: the existing static fee definitions and browser BIC map supplied by `docs/js/bic-data.js`.

- [ ] **Step 1: Create the ESM test command and write failing encoder tests**

```json
{
  "private": true,
  "type": "module",
  "scripts": {
    "test:js": "node --test tests/js/*.test.js",
    "verify:vendor": "node scripts/verify-vendor-assets.js"
  }
}
```

```js
// tests/js/twqrp.test.js
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
  const result = encodeTransfer({
    bankId: "004", account: "123", amount: "9999999999999999", memo: ""
  });
  assert.match(result.payload, /&D1=999999999999999900&D9=$/);
  assert.deepEqual(parseTransferPayload(result.payload), {
    bankId: "004", account: "0000000000000123", amount: "9999999999999999", memo: ""
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
```

- [ ] **Step 2: Run the test and verify the import fails because the legacy script has no exports**

Run: `node --test tests/js/twqrp.test.js`

Expected: FAIL with a named-export or module-interface error for `encodeTransfer`.

- [ ] **Step 3: Convert the encoder into a pure ESM module**

Keep the existing `TWQRP_FEE_LIST` contents unchanged, prefix it with `export`, and add the following implementation around it:

```js
export const TWQRP_AMOUNT_MAX = 9999999999999999n;
const RESERVED_VALUE_CHARS = /[&=?#%\u0000-\u001F\u007F]/u;

export class TwqrpValidationError extends Error {}

function text(value, field) {
  const result = String(value ?? "").trim();
  if ([...result].length > 128) throw new TwqrpValidationError(`${field}過長`);
  return result;
}

function amount(value, required) {
  if (value == null || value === "") {
    if (required) throw new TwqrpValidationError("繳費模式需輸入金額");
    return null;
  }
  const result = text(value, "金額");
  if (!/^[1-9][0-9]*$/.test(result) || BigInt(result) > TWQRP_AMOUNT_MAX) {
    throw new TwqrpValidationError("金額需介於 1 ~ 9999999999999999");
  }
  return result;
}

function memo(value) {
  const result = text(value, "備註");
  if ([...result].length > 19 || RESERVED_VALUE_CHARS.test(result)) {
    throw new TwqrpValidationError("備註包含不支援的字元");
  }
  return result;
}

export function validateTransfer({ bankId, account, amount: rawAmount, memo: rawMemo }) {
  const normalizedBankId = text(bankId, "金融機構代碼");
  const normalizedAccount = text(account, "帳號");
  if (!/^[0-9]{3}$/.test(normalizedBankId)) throw new TwqrpValidationError("金融機構代碼無效");
  if (!/^[0-9]{1,16}$/.test(normalizedAccount)) throw new TwqrpValidationError("帳號必須是 1 至 16 位數字");
  return { bankId: normalizedBankId, account: normalizedAccount.padStart(16, "0"), amount: amount(rawAmount, false), memo: memo(rawMemo) };
}

export function encodeTransfer(input) {
  const fields = validateTransfer(input);
  let payload = `TWQRP://${fields.bankId}NTTransfer/158/02/V1?D6=${fields.account}&D5=${fields.bankId}&D10=901`;
  if (fields.amount !== null) payload += `&D1=${fields.amount}00`;
  return { fields, payload: `${payload}&D9=${fields.memo}` };
}

export function parseTransferPayload(payload) {
  const match = /^TWQRP:\/\/([0-9]{3})NTTransfer\/158\/02\/V1\?(.+)$/u.exec(payload);
  if (!match) throw new TwqrpValidationError("線上服務回傳的 TWQRP 格式無效");
  const seen = new Map();
  const allowed = new Set(["D1", "D5", "D6", "D9", "D10"]);
  for (const pair of match[2].split("&")) {
    const [key, value, ...extra] = pair.split("=");
    if (!key || !allowed.has(key) || extra.length > 0 || seen.has(key)) throw new TwqrpValidationError("TWQRP 欄位重複或格式無效");
    seen.set(key, value ?? "");
  }
  if (!seen.has("D9") || seen.get("D5") !== match[1] || !/^[0-9]{16}$/.test(seen.get("D6") ?? "") || seen.get("D10") !== "901") {
    throw new TwqrpValidationError("TWQRP 必要欄位無效");
  }
  const rawAmount = seen.get("D1");
  const parsedAmount = rawAmount == null ? null : rawAmount.endsWith("00") ? rawAmount.slice(0, -2) : null;
  if (rawAmount != null && (parsedAmount === "" || !/^[1-9][0-9]*$/.test(parsedAmount))) throw new TwqrpValidationError("TWQRP 金額無效");
  return { bankId: match[1], account: seen.get("D6"), amount: parsedAmount, memo: seen.get("D9") ?? "" };
}
```

Update bill encoding to call the same `text`, `amount`, and `memo` helpers, require `^[A-Za-z0-9]{1,64}$` for its account, require its fee item to be one of `TWQRP_FEE_LIST`, and use the returned string amount rather than `parseInt`. Replace the classic `twqrp.js` script tag with an import in `app.js`; remove that classic script tag from `index.html`.

- [ ] **Step 4: Run the focused encoder suite**

Run: `node --test tests/js/twqrp.test.js`

Expected: PASS with the injection, precision, length, and bill-url tests all green.

- [ ] **Step 5: Commit the tested JavaScript encoding boundary**

```bash
git add package.json docs/js/twqrp.js docs/index.html tests/js/twqrp.test.js
git commit -m "fix: validate browser payment payload fields"
```

## Task 2: Add deterministic operation ownership primitives

**Files:**
- Create: `docs/js/operation-controller.js`
- Create: `docs/js/batch-runner.js`
- Create: `tests/js/operation-controller.test.js`
- Create: `tests/js/batch-runner.test.js`

**Interfaces:**
- Produces: `LatestOperation.start()`, `LatestOperation.invalidate()`, `LatestOperation.isCurrent(id)`, and `runBatch(options)`.
- Consumes: `processRow(row)`, `createArchive()`, `onProgress()`, `onComplete()`, and `onError()` callbacks supplied by `app.js`.

- [ ] **Step 1: Write failing stale-operation and overlapping-batch tests with deferred promises**

```js
// tests/js/operation-controller.test.js
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
```

```js
// tests/js/batch-runner.test.js
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
```

- [ ] **Step 2: Run the tests and verify module imports fail**

Run: `node --test tests/js/operation-controller.test.js tests/js/batch-runner.test.js`

Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement the minimum ownership and iterative-runner API**

```js
// docs/js/operation-controller.js
export class LatestOperation {
  #current = 0;
  start() { this.#current += 1; return this.#current; }
  invalidate() { this.#current += 1; }
  isCurrent(id) { return id === this.#current; }
}
```

```js
// docs/js/batch-runner.js
export async function runBatch({ id, rows, isCurrent, processRow, createArchive, onProgress, onComplete, onError }) {
  try {
    for (let index = 0; index < rows.length; index += 1) {
      if (!isCurrent(id)) return;
      await processRow(rows[index], index);
      if (!isCurrent(id)) return;
      onProgress(index + 1, rows.length);
    }
    if (!isCurrent(id)) return;
    const archive = await createArchive();
    if (isCurrent(id)) onComplete(archive);
  } catch (error) {
    if (isCurrent(id)) onError(error);
  }
}
```

- [ ] **Step 4: Run the operation and batch suites**

Run: `node --test tests/js/operation-controller.test.js tests/js/batch-runner.test.js`

Expected: PASS; no test uses a timer or sleep.

- [ ] **Step 5: Commit deterministic async ownership primitives**

```bash
git add docs/js/operation-controller.js docs/js/batch-runner.js tests/js/operation-controller.test.js tests/js/batch-runner.test.js
git commit -m "fix: prevent stale QR operations from committing state"
```

## Task 3: Replace saved-account array storage with consented ID records

**Files:**
- Create: `docs/js/saved-accounts.js`
- Create: `tests/js/saved-accounts.test.js`
- Modify: `docs/index.html:28-62`
- Modify: `docs/css/style.css`
- Modify: `docs/js/app.js:54-145`

**Interfaces:**
- Produces: `SavedAccountStore.list()`, `add(input)`, `remove(id)`, `clear()`, `hasConsent()`, `setConsent()`, `migrateLegacy()`, and `subscribe(listener)`.
- Consumes: browser `indexedDB`, `BroadcastChannel`, `crypto.randomUUID`, and the old `twpay_saved_accounts` localStorage key only during explicit migration.

- [ ] **Step 1: Write failing unit tests for stable identities and explicit consent**

```js
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
```

- [ ] **Step 2: Run the test and verify the module is absent**

Run: `node --test tests/js/saved-accounts.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement the repository with IndexedDB transactions**

```js
export function requireConsent(consented) {
  if (!consented) throw new Error("請先同意在此裝置儲存完整帳號");
}

export function createAccountRecord({ id = crypto.randomUUID(), label, bankId, account }) {
  return Object.freeze({ id, label: String(label).trim(), bankId: String(bankId), account: String(account), createdAt: Date.now() });
}
```

Implement this exact public surface for `SavedAccountStore` with database name `twpay_saved_accounts_v2`, an `accounts` object store keyed by `id`, and a `settings` store keyed by `key`:

```js
export class SavedAccountStore {
  async hasConsent() {}
  async setConsent() {}
  async list() {}
  async add({ label, bankId, account }) {}
  async remove(id) {}
  async clear() {}
  async migrateLegacy() {}
  subscribe(listener) {}
  close() {}
}
```

Each public mutator opens a read-write transaction and broadcasts `"changed"` only after `transaction.oncomplete`. `list()` sorts by `createdAt`; `remove(id)` deletes exactly that key; `clear()` clears the accounts store. `migrateLegacy()` parses legacy JSON only after consent, validates each record with the transfer contract, writes records in one transaction, then removes the legacy key. `subscribe(listener)` registers the callback with the store's `BroadcastChannel` and returns an unsubscribe function; `close()` closes that channel.

Add a visible consent checkbox, import-or-clear legacy controls, and a clear-all button in `index.html`. Add styles for the controls without inline `style` attributes. In `app.js`, render `<option value="record.id">`, await store operations, and refresh on `store.subscribe(renderSavedSelect)`.

- [ ] **Step 4: Run saved-account unit tests and inspect browser syntax**

Run: `node --test tests/js/saved-accounts.test.js && node --check docs/js/app.js`

Expected: PASS and no syntax output.

- [ ] **Step 5: Commit the saved-account migration slice**

```bash
git add docs/js/saved-accounts.js docs/js/app.js docs/index.html docs/css/style.css tests/js/saved-accounts.test.js
git commit -m "refactor: persist saved accounts with stable IDs"
```

## Task 4: Integrate stale-safe single and batch QR UI behavior

**Files:**
- Modify: `docs/js/app.js:1-560`
- Modify: `docs/index.html:72-117`
- Modify: `docs/css/style.css`
- Create: `tests/js/app-state.test.js`

**Interfaces:**
- Consumes: `encodeTransfer`, `twqrpBillEncode`, `LatestOperation`, `runBatch`, and `SavedAccountStore` from Tasks 1–3.
- Produces: a visible canvas and download metadata that always belong to the same completed request.

- [ ] **Step 1: Write a failing pure state test for the rendered-download snapshot**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { LatestOperation } from "../../docs/js/operation-controller.js";

test("only the current request may replace rendered download metadata", () => {
  const jobs = new LatestOperation();
  let rendered = null;
  const first = jobs.start();
  const second = jobs.start();
  if (jobs.isCurrent(first)) rendered = { filename: "old.png" };
  if (jobs.isCurrent(second)) rendered = { filename: "new.png" };
  assert.deepEqual(rendered, { filename: "new.png" });
});
```

- [ ] **Step 2: Run it before integrating the DOM**

Run: `node --test tests/js/app-state.test.js`

Expected: PASS for the already-implemented primitive; this establishes the ownership invariant used by the DOM adapter.

- [ ] **Step 3: Make `app.js` honor operation ownership at every async boundary**

Use this single-generation shape; `copyCanvas` must run only after the second current-ID check:

```js
const singleJobs = new LatestOperation();
let lastRendered = null;

async function generateSingle(dataStr, description, filename) {
  const id = singleJobs.start();
  generateBtn.disabled = true;
  try {
    await fontsReady();
    const temporaryCanvas = document.createElement("canvas");
    await drawQR(temporaryCanvas, dataStr, description);
    if (!singleJobs.isCurrent(id)) return;
    qrCanvas.width = temporaryCanvas.width;
    qrCanvas.height = temporaryCanvas.height;
    qrCanvas.getContext("2d").drawImage(temporaryCanvas, 0, 0);
    lastRendered = { filename, description };
    qrInfo.textContent = description;
    resultArea.classList.remove("hidden");
  } catch (error) {
    if (singleJobs.isCurrent(id)) showError(`QR Code 產生失敗：${error.message}`);
  } finally {
    if (singleJobs.isCurrent(id)) {
      generateBtn.disabled = false;
      generateBtn.textContent = "產生 QR Code";
    }
  }
}
```

Call `singleJobs.invalidate()` and clear `lastRendered` when mode changes or a form input changes. Download must return early without `lastRendered`; otherwise it uses `lastRendered.filename`, not current form values.

For batch work, reject file selection when a run is active, set `csvInput.disabled` and a disabled class on the drop target, wrap `Papa.parse` in a Promise, validate size/row/field limits before calling `runBatch`, and only its `onComplete` may call `saveAs`. Each row creates its own temporary canvas and yields through `await`, so malformed rows cannot recurse through the JavaScript stack.

- [ ] **Step 4: Run all JavaScript tests and syntax checks**

Run: `npm run test:js && node --check docs/js/app.js && node --check docs/js/twqrp.js`

Expected: PASS with no syntax errors.

- [ ] **Step 5: Commit UI ownership and resource-limit integration**

```bash
git add docs/js/app.js docs/index.html docs/css/style.css tests/js/app-state.test.js
git commit -m "fix: serialize browser QR generation jobs"
```

## Task 5: Build Python's canonical transfer core test-first

**Files:**
- Create: `twpay_core.py`
- Create: `tests/python/test_twpay_core.py`

**Interfaces:**
- Produces: `ValidationError`, `TransferFields`, `validate_transfer`, `build_transfer_payload`, `parse_transfer_payload`, and `request_online_payload`.
- Consumes: an injectable `http_get(url, **kwargs)` callable for online requests.

- [ ] **Step 1: Write failing Python contract and online-integrity tests**

```python
from unittest import TestCase
from twpay_core import ValidationError, build_transfer_payload, parse_transfer_payload, request_online_payload


class FakeResponse:
    status_code = 200
    headers = {"Content-Length": "32"}
    def __init__(self, payload): self.payload = payload
    def raise_for_status(self): return None
    def iter_content(self, chunk_size): yield self.payload.encode("utf-8")


class TransferCoreTests(TestCase):
    def test_preserves_maximum_amount_exactly(self):
        payload = build_transfer_payload("004", "123", "9999999999999999", "")
        self.assertIn("D1=999999999999999900", payload)

    def test_rejects_query_injection(self):
        with self.assertRaises(ValidationError):
            build_transfer_payload("004", "123", None, "&D1=1")

    def test_rejects_online_payload_for_another_account(self):
        wrong = build_transfer_payload("004", "999", None, "")
        with self.assertRaises(ValidationError):
            request_online_payload("004", "123", None, "", http_get=lambda *args, **kwargs: FakeResponse('{"Success":"1","String":"' + wrong + '"}'))
```

- [ ] **Step 2: Run the test and verify imports fail**

Run: `python3 -m unittest tests.python.test_twpay_core -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'twpay_core'`.

- [ ] **Step 3: Implement the pure core and bounded online client**

```python
AMOUNT_MAX = 9_999_999_999_999_999
MAX_API_RESPONSE_BYTES = 1_048_576

class ValidationError(ValueError):
    pass

def build_transfer_payload(bank_id, account, amount=None, memo=""):
    fields = validate_transfer(bank_id, account, amount, memo)
    payload = f"TWQRP://{fields.bank_id}NTTransfer/158/02/V1?D6={fields.account}&D5={fields.bank_id}&D10=901"
    if fields.amount is not None:
        payload += f"&D1={fields.amount}00"
    return f"{payload}&D9={fields.memo}"
```

`validate_transfer` must use `re.fullmatch`, count code points with `len`, pad only a validated account to 16 digits, and reject reserved memo characters. `parse_transfer_payload` must reject duplicate fields and require matching `D5`, `D6`, and `D10`. `request_online_payload` must call the injected client with `timeout=10`, `allow_redirects=False`, and `stream=True`; reject a non-200 response, an oversized `Content-Length` or streamed body, malformed JSON, `Success != "1"`, and any parsed response not exactly equal to the parsed expected local payload.

- [ ] **Step 4: Run the focused Python core tests**

Run: `python3 -m unittest tests.python.test_twpay_core -v`

Expected: PASS for exact maximum amount, injection rejection, and mismatched online response.

- [ ] **Step 5: Commit the Python payment-core boundary**

```bash
git add twpay_core.py tests/python/test_twpay_core.py
git commit -m "fix: validate Python payment payloads offline"
```

## Task 6: Add safe PNG publication and refactor the Python CLI

**Files:**
- Create: `twpay_io.py`
- Create: `tests/python/test_twpay_io.py`
- Modify: `app.py`
- Modify: `sample.csv`

**Interfaces:**
- Produces: `OutputPathError`, `reserve_output_path(output_dir, stem)`, and `publish_image(image, reservation)`.
- Consumes: `build_transfer_payload` and `request_online_payload` from Task 5 and `PIL.Image.Image.save` from the existing renderer.

- [ ] **Step 1: Write failing path traversal and concurrent reservation tests**

```python
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from twpay_io import OutputPathError, reserve_output_path


class OutputPathTests(TestCase):
    def test_rejects_traversal_name(self):
        with TemporaryDirectory() as directory:
            with self.assertRaises(OutputPathError):
                reserve_output_path(Path(directory), "../../owned")

    def test_reserves_distinct_paths_for_same_stem(self):
        with TemporaryDirectory() as directory:
            first = reserve_output_path(Path(directory), "台銀")
            second = reserve_output_path(Path(directory), "台銀")
            self.assertNotEqual(first.target, second.target)
            first.release()
            second.release()
```

- [ ] **Step 2: Run the I/O test and verify imports fail**

Run: `python3 -m unittest tests.python.test_twpay_io -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'twpay_io'`.

- [ ] **Step 3: Implement lock-file reservation and atomic image publication**

```python
from dataclasses import dataclass
from pathlib import Path
import os

@dataclass
class Reservation:
    target: Path
    lock: Path
    def release(self):
        self.lock.unlink(missing_ok=True)

def reserve_output_path(output_dir: Path, stem: str) -> Reservation:
    normalized = validate_output_stem(stem)
    directory = output_dir.resolve(strict=True)
    if not directory.is_dir():
        raise OutputPathError("輸出目錄不存在")
    for number in range(10_000):
        suffix = "" if number == 0 else f"-{number}"
        target = directory / f"{normalized}{suffix}.png"
        lock = directory / f".{normalized}{suffix}.png.lock"
        try:
            fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        except FileExistsError:
            continue
        else:
            os.close(fd)
            if target.exists():
                lock.unlink(missing_ok=True)
                continue
            return Reservation(target=target, lock=lock)
    raise OutputPathError("無法保留唯一輸出檔名")
```

`publish_image` saves to `NamedTemporaryFile(dir=target.parent, suffix=".png", delete=False)`, uses `os.replace(temp_name, target)` only after Pillow succeeds, and always removes the lock and failed temporary file. `validate_output_stem` rejects empty names, `.`/`..`, absolute paths, `/`, `\\`, controls, and names over 100 code points while retaining valid Chinese display names.

Refactor `app.py` to use an argparse mutually exclusive group: `--online` sets `online=True`, while a hidden `--offline` compatibility flag sets it false. Add `--output-dir` defaulting to `Path(".")`. Validate required CSV headers, use `Path.stat().st_size` before opening, enforce 1,000 data rows/128 code-point cells, use `read_bic_map`, generate the canonical payload locally unless `online`, and publish each image via a reservation.

- [ ] **Step 4: Run CLI-related tests and the help command**

Run: `python3 -m unittest tests.python.test_twpay_io tests.python.test_twpay_core -v && python3 app.py -h`

Expected: all tests PASS; help documents `--online` and `--output-dir`.

- [ ] **Step 5: Commit secure CLI output and offline-default behavior**

```bash
git add twpay_io.py app.py sample.csv tests/python/test_twpay_io.py
git commit -m "fix: publish CLI QR images safely"
```

## Task 7: Make BIC refresh bounded and atomically published

**Files:**
- Create: `twpay_bic.py`
- Create: `tests/python/test_twpay_bic.py`
- Modify: `update_bic.py`
- Modify: `app.py`

**Interfaces:**
- Produces: `read_bic_map(path)`, `parse_source_bic_csv(content)`, `update_bic_dataset(http_get, destination)`, and `BicUpdateError`.
- Consumes: an injectable HTTP client and the output data path supplied by the two CLI scripts.

- [ ] **Step 1: Write failing atomic-update tests**

```python
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from twpay_bic import BicUpdateError, read_bic_map, update_bic_dataset

class FakeResponse:
    headers = {"Content-Length": "7"}
    def __init__(self, payload): self.payload = payload
    def raise_for_status(self): return None
    def iter_content(self, chunk_size): yield self.payload

class BicUpdateTests(TestCase):
    def test_invalid_download_keeps_previous_normalized_file(self):
        with TemporaryDirectory() as directory:
            destination = Path(directory) / "BIC.csv"
            destination.write_text("BIC,Name\n004,臺灣銀行\n", encoding="utf-8")
            with self.assertRaises(BicUpdateError):
                update_bic_dataset(lambda *args, **kwargs: FakeResponse(b"not,csv"), destination)
            self.assertEqual(read_bic_map(destination), {"004": "臺灣銀行"})
```

- [ ] **Step 2: Run it and verify the BIC module is absent**

Run: `python3 -m unittest tests.python.test_twpay_bic -v`

Expected: FAIL with `ModuleNotFoundError: No module named 'twpay_bic'`.

- [ ] **Step 3: Implement bounded source parsing, lock, and replacement**

```python
def update_bic_dataset(http_get, destination: Path, url=CSV_URL):
    with exclusive_lock(destination.with_suffix(destination.suffix + ".lock")):
        response = http_get(url, timeout=10, allow_redirects=False, stream=True)
        response.raise_for_status()
        mapping = parse_source_bic_csv(read_limited(response, MAX_BIC_DOWNLOAD_BYTES))
        write_normalized_bic_atomically(destination, mapping)
        return mapping
```

`parse_source_bic_csv` decodes `utf-8-sig`, requires the exact three source headers used by the current updater, selects only `跨行自動化服務機器業務(金融卡)`, accepts only three-digit BICs with nonempty names, and rejects an empty mapping. `write_normalized_bic_atomically` uses a same-directory temporary UTF-8 CSV and `os.replace`. `read_bic_map` requires normalized `BIC,Name` headers and fails rather than returning a partial map. `update_bic.py` parses no CSV itself; it uses `argparse` with `--destination` defaulting to `data/BIC.csv`, invokes this function, and prints only the updated record count. This preserves a successful `python3 update_bic.py -h` without networking.

- [ ] **Step 4: Run BIC, core, and output tests together**

Run: `python3 -m unittest tests.python.test_twpay_bic tests.python.test_twpay_core tests.python.test_twpay_io -v`

Expected: PASS; malformed downloads leave the old BIC file unchanged.

- [ ] **Step 5: Commit atomic BIC publication**

```bash
git add twpay_bic.py update_bic.py app.py tests/python/test_twpay_bic.py
git commit -m "fix: atomically publish validated BIC data"
```

## Task 8: Vendor front-end assets and enforce local-only browser execution

**Files:**
- Create: `docs/vendor/qrcode-1.5.3.mjs`
- Create: `docs/vendor/papaparse-5.4.1.min.js`
- Create: `docs/vendor/jszip-3.10.1.min.js`
- Create: `docs/vendor/file-saver-2.0.5.min.js`
- Create: `docs/vendor/LICENSES.md`
- Create: `docs/vendor/manifest.json`
- Create: `scripts/verify-vendor-assets.js`
- Create: `tests/js/vendor-policy.test.js`
- Modify: `docs/index.html`
- Modify: `requirements.txt`

**Interfaces:**
- Produces: a local-only payment page and `npm run verify:vendor` exit code 0 only when assets match the reviewed manifest.
- Consumes: exact reviewed upstream release artifacts downloaded over HTTPS during implementation and their license texts.

- [ ] **Step 1: Write failing local-asset and CSP policy tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("payment page has no remote executable assets and declares CSP", async () => {
  const html = await readFile("docs/index.html", "utf8");
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.doesNotMatch(html, /https:\/\/cdn\.jsdelivr\.net|https:\/\/fonts\.googleapis\.com/);
  assert.match(html, /src="vendor\/papaparse-5\.4\.1\.min\.js"/);
});
```

- [ ] **Step 2: Run the policy test and confirm current CDN references fail it**

Run: `node --test tests/js/vendor-policy.test.js`

Expected: FAIL because `index.html` references jsDelivr and Google Fonts.

- [ ] **Step 3: Vendor exact release files and implement manifest verification**

Download the exact package release artifacts to the paths above, record each filename, upstream version, license, source URL, and SHA-256 in `docs/vendor/manifest.json`, and copy the relevant license texts into `LICENSES.md`:

```bash
curl --fail --location --proto '=https' --tlsv1.2 https://cdn.jsdelivr.net/npm/qrcode@1.5.3/+esm -o docs/vendor/qrcode-1.5.3.mjs
curl --fail --location --proto '=https' --tlsv1.2 https://cdn.jsdelivr.net/npm/papaparse@5.4.1/papaparse.min.js -o docs/vendor/papaparse-5.4.1.min.js
curl --fail --location --proto '=https' --tlsv1.2 https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js -o docs/vendor/jszip-3.10.1.min.js
curl --fail --location --proto '=https' --tlsv1.2 https://cdn.jsdelivr.net/npm/file-saver@2.0.5/dist/FileSaver.min.js -o docs/vendor/file-saver-2.0.5.min.js
shasum -a 256 docs/vendor/*.{js,mjs}
```

`scripts/verify-vendor-assets.js` must read that manifest, calculate each file's SHA-256 with `createHash("sha256")`, and throw when a path is absent or hash differs:

```js
const actual = createHash("sha256").update(await readFile(asset.path)).digest("hex");
if (actual !== asset.sha256) throw new Error(`${asset.path} hash mismatch`);
```

Update HTML to load the three non-module libraries from `vendor/`, import QRCode from `./vendor/qrcode-1.5.3.mjs` in `app.js`, remove the Google Font links, move every inline `style` value to CSS classes, and add the exact CSP from the design specification. Update direct Python pins to `idna==3.15` and `urllib3==2.7.0`.

- [ ] **Step 4: Run vendor policy, asset hash, and full JavaScript tests**

Run: `npm run verify:vendor && npm run test:js`

Expected: PASS; tampering with a copied asset should make `npm run verify:vendor` fail before restoring it.

- [ ] **Step 5: Commit local payment-page supply chain controls**

```bash
git add docs/vendor scripts/verify-vendor-assets.js tests/js/vendor-policy.test.js docs/index.html docs/js/app.js docs/css/style.css requirements.txt
git commit -m "fix: execute payment page dependencies locally"
```

## Task 9: Document behavior and add continuous verification

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: reproducible CI commands: Python unit tests, JavaScript unit tests, vendor integrity, and `pip-audit`.
- Consumes: all test commands and files introduced in Tasks 1–8.

- [ ] **Step 1: Write a failing command-level smoke check for the documented test scripts**

```bash
npm run test:js
npm run verify:vendor
python3 -m unittest discover -s tests/python -v
```

Expected before this task: commands may pass locally but are not present in tracked CI or README.

- [ ] **Step 2: Add the GitHub Actions workflow**

```yaml
name: test
on: [push, pull_request]
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - uses: actions/setup-node@v4
        with: { node-version: "22" }
      - run: python -m pip install --upgrade pip
      - run: python -m pip install -r requirements.txt pip-audit
      - run: python -m unittest discover -s tests/python -v
      - run: npm run test:js
      - run: npm run verify:vendor
      - run: pip-audit -r requirements.txt
```

Document `--online`, its data-disclosure consequence, `--output-dir`, CSV limits, explicit saved-account consent, clear/import behavior, and the three test commands. Add `.png.lock` and temporary PNG patterns to `.gitignore` while retaining the existing generated-image exclusions.

- [ ] **Step 3: Run the full local verification set**

Run: `python3 -m unittest discover -s tests/python -v && npm run test:js && npm run verify:vendor && python3 app.py -h && python3 update_bic.py -h`

Expected: all local suites PASS; both CLI help commands return 0 without networking.

- [ ] **Step 4: Commit CI and documentation**

```bash
git add .github/workflows/test.yml README.md .gitignore
git commit -m "test: automate payment QR security checks"
```

## Task 10: Browser and final regression verification

**Files:**
- Modify only if verification reveals a proven defect in a previous task.

**Interfaces:**
- Consumes: the local static page and all completed test suites.
- Produces: evidence that the browser integration obeys the same contracts as the unit tests.

- [ ] **Step 1: Serve `docs/` locally and open it in a real browser**

Run: `python3 -m http.server 8000 --directory docs`

Expected: page opens at `http://localhost:8000` with no remote JavaScript requests.

- [ ] **Step 2: Verify payment, stale-result, batch, and persistence behavior**

Use browser DevTools to confirm all of the following:

```text
1. A transfer with a valid 16-digit account and maximum amount renders correctly.
2. A memo containing &D1=1 is rejected and no canvas updates.
3. Change form mode while a deliberately delayed render is pending; the old result does not reappear.
4. Start a batch, attempt to choose another file, and observe that selection/start remains locked until completion.
5. Give saved-account consent, save an account, open a second tab, and observe the new record by UUID after BroadcastChannel refresh.
6. Clear all accounts and observe both tabs update.
7. Console contains no errors; network shows no CDN, Google Fonts, or payment API request in offline mode.
8. CSP is present in the document and blocks an injected remote script in a controlled DevTools experiment.
```

- [ ] **Step 3: Run final automated verification after any browser-driven correction**

Run: `python3 -m unittest discover -s tests/python -v && npm run test:js && npm run verify:vendor && git diff --check && git status --short`

Expected: all checks PASS and status is clean after committing any correction.

- [ ] **Step 4: Perform final review and create the final atomic commit if a verification correction was needed**

```bash
git diff --staged --check
git diff --staged | rg -i "password|secret|api[_-]?key|token"
git commit -m "fix: complete payment QR browser verification"
```

## Plan Self-Review

- **Spec coverage:** Tasks 1 and 5 cover canonical validation and exact amounts; Tasks 4 and 6 cover stale UI and output races; Task 7 covers BIC atomicity; Task 3 covers consented cross-tab persistence; Task 8 covers CDN/CSP and dependency pins; Tasks 4, 6, 7, and 9 enforce resource limits and continuous verification.
- **Placeholder scan:** The plan names every target file, public interface, command, expected result, and acceptance check; no deferred implementation markers remain.
- **Type consistency:** JavaScript uses `LatestOperation`, `runBatch`, `encodeTransfer`, and `SavedAccountStore` consistently. Python uses `ValidationError`, `build_transfer_payload`, `request_online_payload`, `reserve_output_path`, and `update_bic_dataset` consistently.
