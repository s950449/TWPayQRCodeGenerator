# QRCode Vendor Dependency Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the deployed QRCode ESM graph completely local and resolvable on GitHub Pages.

**Architecture:** Keep `docs/js/app.js` unchanged. Repair the QRCode module boundary by colocating its two exact ESM dependencies in `docs/vendor/`, rewriting only its import specifiers, and enforcing that boundary with a Node test plus the existing SHA-256 manifest check.

**Tech Stack:** Native browser ESM, Node `node:test`, SHA-256 manifest verification, GitHub Pages static hosting.

## Global Constraints

- QRCode remains `1.5.3`; `encode-utf8` and `dijkstrajs` remain `1.0.3`.
- No remote runtime script or import may be introduced.
- Each vendored artifact must have a source URL, license, and SHA-256 manifest entry.
- The focused test must fail before the import repair and pass afterward.

---

### Task 1: Add an ESM vendor-closure regression test

**Files:**
- Create: `tests/js/vendor-closure.test.js`

**Interfaces:**
- Consumes: `docs/vendor/qrcode-1.5.3.mjs`.
- Produces: a deterministic `node:test` failure whenever a QRCode dependency is
  root-relative, remote, or absent from `docs/vendor/`.

- [ ] **Step 1: Write the failing test**

```js
test("QRCode vendor graph contains only local relative modules", async () => {
  const unresolved = await findUnresolvedImports(qrcodePath);
  assert.deepEqual(unresolved, []);
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test tests/js/vendor-closure.test.js`

Expected: FAIL, reporting the two `/npm/...` imports.

- [ ] **Step 3: Commit the test with the repair task**

```bash
git add tests/js/vendor-closure.test.js
git commit -m "test: detect unresolved QRCode vendor imports"
```

### Task 2: Close the QRCode dependency graph

**Files:**
- Modify: `docs/vendor/qrcode-1.5.3.mjs`
- Create: `docs/vendor/encode-utf8-1.0.3.mjs`
- Create: `docs/vendor/dijkstrajs-1.0.3.mjs`
- Modify: `docs/vendor/manifest.json`
- Modify: `docs/vendor/LICENSES.md`

**Interfaces:**
- QRCode imports `./encode-utf8-1.0.3.mjs` and `./dijkstrajs-1.0.3.mjs`.
- The manifest continues to verify every asset by path and SHA-256.

- [ ] **Step 1: Copy the two pinned ESM artifacts from their recorded sources**

Sources:

```text
https://cdn.jsdelivr.net/npm/encode-utf8@1.0.3/+esm
https://cdn.jsdelivr.net/npm/dijkstrajs@1.0.3/+esm
```

- [ ] **Step 2: Rewrite QRCode imports to relative specifiers**

```js
import * as ne from "./encode-utf8-1.0.3.mjs";
import * as re from "./dijkstrajs-1.0.3.mjs";
```

- [ ] **Step 3: Add manifest and license entries for both artifacts**

- [ ] **Step 4: Verify the focused test passes**

Run: `node --test tests/js/vendor-closure.test.js`

Expected: PASS.

- [ ] **Step 5: Run the vendor and JavaScript suites**

Run: `npm run verify:vendor && npm run test:js`

Expected: all hashes verify and all tests pass.

- [ ] **Step 6: Commit the complete repair**

```bash
git add docs/vendor tests/js
git commit -m "fix: close QRCode vendor dependency graph"
```
