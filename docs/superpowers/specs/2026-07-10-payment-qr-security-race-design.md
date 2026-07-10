# Payment QR Security and Concurrency Refactor

## Status

Accepted on 2026-07-10.

## Context

This repository has two implementations of Taiwan Pay QR generation: a Python
CSV CLI and a static browser application. Both handle payment identifiers and
both lacked automated tests. The audit found protocol-field injection,
non-canonical money parsing, unsafe file output, third-party execution at the
payment page origin, stale asynchronous UI updates, overlapping batch jobs,
non-atomic BIC updates, and cross-tab saved-account conflicts.

## Goals

- Generate only unambiguous, validated payment payloads.
- Keep generation offline by default and minimize disclosure of payment data.
- Make asynchronous browser work and filesystem publication race-safe.
- Retain saved accounts only after explicit user consent, without losing data
  across cooperating browser tabs.
- Add deterministic regression tests and continuous verification without
  introducing a heavyweight front-end build system.

## Non-goals

- Change the meaning of valid existing TWQRP fields.
- Add a backend, authentication system, or cloud account synchronization.
- Claim that browser-side persistent storage encrypts account numbers.
- Change the project from a static GitHub Pages site into a framework app.

## Chosen Approach

Use small, testable modules around the current vanilla JavaScript and Python
entry points. This is preferred over inline patches, which would retain
coupling and make race regressions difficult to test, and over adopting a
complete build/test stack, whose complexity is disproportionate to the app.

## Architecture

### Canonical payment-input contract

Both runtimes validate at the encoder boundary rather than trusting HTML form
attributes or CSV shape.

| Field | Transfer contract | Bill contract |
| --- | --- | --- |
| Bank ID | Exactly three ASCII digits and present in the BIC map | Not supplied; a configured fee item is required |
| Account | 1–16 ASCII digits | 1–64 ASCII letters or digits |
| Amount | Optional, but when supplied a canonical positive decimal integer no greater than `9999999999999999` | Required under the same numeric rules |
| Memo | At most 19 Unicode code points; no controls or TWQRP delimiters `&`, `=`, `?`, `#`, `%` | Same |

JavaScript validates amounts as decimal strings and uses `BigInt` only for
comparison; it builds the `D1` minor-unit value by string concatenation. It
does not use `parseInt` for accepted values. Python follows the same contract
with `int` only after a full-string decimal check. A completed payload is
parsed in tests and compared with the intended bank, account, amount, and
memo fields.

The browser encoder remains `docs/js/twqrp.js`, converted to an ESM module
exporting pure validation and encoding functions. The Python equivalent moves
into a dependency-light core module used by `app.py`. The two implementations
have shared fixtures of valid and invalid cases so they retain wire-format
parity while remaining independently executable.

### Python CLI and filesystem safety

`app.py` defaults to local, canonical generation. Remote generation becomes an
explicit `--online` opt-in. Online requests use an explicit timeout, do not
follow redirects, cap response size, and fail closed on malformed JSON or a
payload whose parsed fields do not match the requested transaction. Verbose
mode redacts payment fields rather than printing complete payloads.

CSV `Name` is treated as a display stem, never as a path. It rejects absolute
paths, separators, traversal segments, controls, and empty values. The CLI
adds `--output-dir` while retaining the current directory as its default for
compatibility. A filename is reserved with exclusive creation, rendered to a
same-directory temporary PNG, then atomically replaced. A collision receives a
safe numeric suffix, so concurrent CLI invocations cannot overwrite each
other's result.

`update_bic.py` downloads into memory only within a bounded size limit, checks
the expected source columns and each selected BIC row, writes a validated
normalized CSV to a same-directory temporary file, and publishes it with
`os.replace`. A lock file acquired with exclusive creation prevents two
updaters from publishing concurrently. Readers therefore observe either the
complete old CSV or the complete new CSV, never an intermediate raw download.

### Browser asynchronous work

A small operation controller owns monotonically increasing IDs.

- A single QR generation snapshots its request and renders to an off-screen
  canvas. Only the active ID may copy that canvas to the visible canvas,
  display a result or error, change button state, or set download metadata.
  Mode changes invalidate the active operation.
- A batch run owns its ID, parsed input, ZIP instance, and completion state.
  Selecting a file and starting another run are disabled while it is active.
  Every asynchronous boundary—CSV parsing, font loading, QR rendering,
  `toBlob`, ZIP generation, and download—checks that its ID is still active.
  Batch rows are processed with an iterative async loop, not recursive calls.
- Download filenames come from the immutable metadata of the successfully
  rendered QR, never from live form state.

### Saved accounts

Persistent accounts move from an origin-wide localStorage JSON array to an
IndexedDB `accounts` object store keyed by UUID. Records are added and removed
in transactions, and select values use IDs rather than mutable array indexes.
`BroadcastChannel` tells other open tabs to refresh after a mutation.

The first save requires an explicit acknowledgement that a full account number
will be saved on this device. A clear-all control deletes all records. Legacy
localStorage data is neither silently imported nor silently retained in the
new store: on first use, the app offers an explicit import-or-clear choice.
This is a privacy and concurrency improvement, not encryption; a compromised
same-origin script could still read any browser-accessible data.

### Supply chain and browser policy

The QRCode, PapaParse, JSZip, and FileSaver runtime assets are vendored under
`docs/vendor/` at reviewed versions with their license notices and a hash
manifest. `index.html` loads only local scripts, and the external Google Fonts
request is removed. Inline style attributes are moved into the stylesheet so
the page can use this meta Content Security Policy:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'
```

GitHub Pages cannot reliably configure every HTTP response header. In
particular, frame-ancestor protection requires a response header and is
documented as a hosting limitation rather than claimed as delivered by the
meta policy.

The direct Python pins update to `idna==3.15` and `urllib3==2.7.0`, which
contain fixes for advisories affecting the current pins.

### Resource limits

The browser and CLI reject input files larger than 5 MiB, batches over 1,000
rows, and individual fields over 128 code points before expensive rendering or
ZIP allocation. These values are named constants so a future product decision
can adjust them deliberately.

## Error handling

Validation failures identify the rejected field without echoing full account
or payload data. External API, BIC-update, image, and ZIP errors are surfaced
as controlled messages. An invalid or stale asynchronous operation cannot
modify visible state or trigger a download. Failed BIC refreshes retain the
last known-good file.

## Test Strategy

No third-party test framework is required.

- JavaScript uses Node's built-in `node --test` runner for encoder contracts,
  injection rejection, amount boundaries, operation IDs with manually
  controlled deferred promises, batch ownership, and saved-account behavior
  against an in-memory repository double.
- Python uses `unittest` for the equivalent input contract, online-client
  failure paths through injected fakes, safe output names, unique output
  reservation, BIC validation, atomic publication, updater locking, and CSV
  limits.
- Tests use barriers/deferred promises rather than sleeps so stale-result and
  overlapping-batch regressions are deterministic.
- A browser verification pass checks CSP enforcement, console cleanliness,
  file-selection locking, stale-result suppression, consent flow, and
  cross-tab refresh with real browser APIs.
- GitHub Actions installs the Python requirements, runs the Python and Node
  suites, executes `pip-audit -r requirements.txt`, and verifies hashes of
  vendored browser assets.

## Migration and Compatibility

Valid offline payloads retain their existing format. Existing Python users who
need the third-party API must add `--online`; the README explains that this
sends payment metadata off-device. Existing saved accounts require an
explicit one-time import decision. Existing CSVs with valid values continue to
work; malformed fields, unsafe filenames, oversized files, and ambiguous
amounts intentionally fail with actionable errors.

## Acceptance Criteria

1. No accepted input can introduce an extra TWQRP field or lose monetary
   precision.
2. The CLI is offline by default; online data is bounded, timeout-controlled,
   and semantically verified before rendering.
3. CSV names cannot escape the output directory, and concurrent writers do
   not overwrite the same PNG.
4. BIC readers observe only complete normalized files during a refresh.
5. An obsolete single operation or batch callback cannot update UI, alter busy
   state, or download an archive.
6. Persistent accounts require consent, use stable identifiers, and refresh
   across cooperating tabs.
7. The payment page executes no remote runtime scripts and passes its CSP and
   asset-integrity checks.
8. The new automated suites and browser verification pass from a clean
   environment.
