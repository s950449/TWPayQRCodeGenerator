# QRCode Vendor Dependency Closure Design

## Status

Approved for implementation on 2026-07-10.

## Context

The deployed payment page loads `docs/js/app.js` as an ES module. Its QRCode
dependency is stored locally, but that file still imports two root-relative
jsDelivr paths. GitHub Pages returns 404 for those paths, so the module graph
fails before the page can populate the BIC select or register mode-tab events.

## Decision

Keep the existing local-only browser policy. Vendor the exact
`encode-utf8@1.0.3` and `dijkstrajs@1.0.3` ESM artifacts beside QRCode, then
replace QRCode's root-relative imports with relative paths. Record every new
artifact in the hash manifest and license inventory.

Add a Node test that starts at the vendored QRCode module, recursively resolves
relative static ESM imports, and asserts that no root-relative or remote import
remains. This catches an incomplete vendor closure before deployment.

## Alternatives Considered

- Restore CDN imports: rejected because it violates the local-only runtime
  policy and CSP objective.
- Replace QRCode with a UMD build: rejected because it changes the app loading
  model without solving a requirement this repair needs to change.

## Constraints

- Preserve the currently used package versions: QRCode 1.5.3,
  encode-utf8 1.0.3, and dijkstrajs 1.0.3.
- Do not add runtime network requests or loosen the CSP.
- Keep vendor artifacts pinned, licensed, and SHA-256 verified.
- The regression test must fail against the current unresolved imports and pass
  only after the vendor closure is complete.

## Verification

- Run the focused ESM closure test before and after the repair.
- Run `npm run test:js` and `npm run verify:vendor` after the repair.
- Import the local QRCode module with Node to prove its dependency graph links.
