import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);
const read = async (path) => (await readFile(new URL(path, root), "utf8"))
  .split("\n").filter((line) => !line.trimStart().startsWith("#")).join("\n");

test("workflows keep explicit least-privilege defaults and avoid privileged PR triggers", async () => {
  const files = (await readdir(new URL(".github/workflows/", root))).filter((f) => f.endsWith(".yml"));
  for (const file of files) {
    const content = await read(`.github/workflows/${file}`);
    assert.match(content, /^permissions: \{\}$/m, file);
    assert.doesNotMatch(content, /^\s*(pull_request_target|workflow_run):/m, file);
    assert.doesNotMatch(content, /secrets:\s*inherit|secrets\./, file);
    assert.doesNotMatch(content, /persist-credentials:\s*true/, file);
    const checkouts = [...content.matchAll(/uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=\n\s*- |\n\S|$)/g)];
    for (const checkout of checkouts) {
      assert.match(checkout[1], /persist-credentials: false/, file);
      assert.doesNotMatch(checkout[1], /\bref:/, file);
    }
  }
});

test("test workflow never receives a write permission or installs unpinned tools", async () => {
  const ci = await read(".github/workflows/test.yml");
  assert.doesNotMatch(ci, /:\s*write\b/);
  assert.match(ci, /--require-hashes --only-binary=:all:/);
  assert.match(ci, /sha256sum --check/);
  assert.match(ci, /gh-actions-lock" --verify/);
});

test("deployment privileges are isolated from checkout and repository code", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /needs: verify/);
  const deploy = workflow.split("\n  deploy:\n")[1];
  assert.ok(deploy);
  assert.match(deploy, /needs: package/);
  assert.match(deploy, /pages: write/);
  assert.match(deploy, /id-token: write/);
  assert.doesNotMatch(deploy, /uses: actions\/checkout|^\s+run:/m);
});

test("Pages artifact contains only allowlisted site files", async () => {
  const workflow = await read(".github/workflows/deploy.yml");
  assert.doesNotMatch(workflow, /^\s+path: docs\s*$/m);
  assert.match(workflow, /cp -R docs\/index\.html docs\/css docs\/js docs\/vendor docs\/data "\$site\/"/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/site/);
});

test("CODEOWNERS has a catch-all owner so CI-defining files need review", async () => {
  const owners = await read(".github/CODEOWNERS");
  assert.match(owners, /^\* @\S+/m);
});

test("external-data producer is read-only and publisher consumes this run's artifact", async () => {
  const workflow = await read(".github/workflows/update-bic.yml");
  const prepare = workflow.split("\n  prepare:\n")[1].split("\n  propose:\n")[0];
  assert.doesNotMatch(prepare, /:\s*write\b|pip install|npm install|GH_TOKEN:/);
  const propose = workflow.split("\n  propose:\n")[1];
  assert.match(propose, /needs: prepare/);
  assert.match(propose, /name: bic-candidate/);
  assert.doesNotMatch(propose, /run-id:|repository:|ref:|pip install|npm install/);
  assert.match(propose, /run: python scripts\/publish_bic_update.py/);
});
