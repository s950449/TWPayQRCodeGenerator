"""Trusted-main-only publisher. Candidate artifacts are data, never executable code."""
import base64
import json
import os
import re
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

from bic_assets import (
    ASSET_PATHS, CSV_PATH, MANIFEST_PATH, ROOT, assets, describe_change,
    read_bic_map, validate_change,
)
from twpay_bic import _NoRedirect

REPOSITORY = "s950449/TWPayQRCodeGenerator"
BRANCH = "automation/update-bic"
MAX_FILE_BYTES = 128 * 1024


def validate_bundle(bundle, baseline=ROOT):
    """Recreate every byte from parsed CSV; never trust JS supplied by the producer."""
    entries = list(bundle.rglob("*"))
    if any(path.is_symlink() for path in entries):
        raise ValueError("Candidate must not contain symlinks")
    files = {path.relative_to(bundle).as_posix() for path in entries if path.is_file()}
    if files != set(ASSET_PATHS):
        raise ValueError("Candidate must contain exactly the three allowlisted files")
    if any((bundle / name).stat().st_size > MAX_FILE_BYTES for name in ASSET_PATHS):
        raise ValueError("Candidate file too large")
    previous = read_bic_map(baseline / CSV_PATH)
    current = read_bic_map(bundle / CSV_PATH)
    validate_change(previous, current)
    manifest = json.loads((bundle / MANIFEST_PATH).read_text(encoding="utf-8"))
    timestamp = manifest["updated_at"]
    parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None or parsed > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise ValueError("Invalid manifest timestamp")
    expected = assets(current, timestamp)
    for name, content in expected.items():
        if (bundle / name).read_bytes() != content:
            raise ValueError(f"Candidate content mismatch: {name}")
    return previous, current, expected


class GitHub:
    def __init__(self, token):
        self.token = token

    def request(self, method, path, payload=None, missing_ok=False):
        # Fixed host/repository. Never send the token to the source-data host.
        request = urllib.request.Request(
            f"https://api.github.com/repos/{REPOSITORY}/{path}",
            data=None if payload is None else json.dumps(payload).encode(),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
                "Content-Type": "application/json",
            },
            method=method,
        )
        try:
            opener = urllib.request.build_opener(_NoRedirect())
            with opener.open(request, timeout=30) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            if missing_ok and exc.code == 404:
                return None
            # Don't print remote bodies (which may contain untrusted text).
            raise RuntimeError(f"GitHub API {method} {path}: HTTP {exc.code}") from None


def publish(api, base_sha, previous, current, content):
    if previous == current:
        print("No BIC changes; no branch or PR created.")
        return
    actual_base = api.request("GET", "git/ref/heads/main")["object"]["sha"]
    if actual_base != base_sha:
        raise ValueError("main advanced during preparation; rerun against the new main")

    ref = api.request("GET", f"git/ref/heads/{BRANCH}", missing_ok=True)
    head = ref["object"]["sha"] if ref else None
    if head:
        # Do not overwrite contributor work or adopt an unrelated preexisting branch.
        comparison = api.request("GET", f"compare/{base_sha}...{head}")
        changed = {item["filename"] for item in comparison["files"]}
        if (not changed and comparison["ahead_by"] > 0
                or not changed <= set(ASSET_PATHS) or comparison["ahead_by"] > 100):
            raise ValueError("Existing bot branch is not data-only; inspect it manually")

    base_commit = api.request("GET", f"git/commits/{base_sha}")
    tree = []
    for name in ASSET_PATHS:
        blob = api.request("POST", "git/blobs", {
            "encoding": "base64", "content": base64.b64encode(content[name]).decode("ascii"),
        })
        tree.append({"path": name, "mode": "100644", "type": "blob", "sha": blob["sha"]})
    new_tree = api.request("POST", "git/trees", {
        "base_tree": base_commit["tree"]["sha"], "tree": tree,
    })["sha"]
    old_tree = api.request("GET", f"git/commits/{head}")["tree"]["sha"] if head else None
    if new_tree != old_tree:
        # Include main and the previous bot head; fast-forward only, never force-push.
        parents = list(dict.fromkeys([head, base_sha] if head else [base_sha]))
        commit = api.request("POST", "git/commits", {
            "message": "chore: refresh FISC BIC data", "tree": new_tree, "parents": parents,
        })["sha"]
        if head:
            api.request("PATCH", f"git/refs/heads/{BRANCH}", {"sha": commit, "force": False})
        else:
            api.request("POST", "git/refs", {"ref": f"refs/heads/{BRANCH}", "sha": commit})

    # Source names stay JSON-escaped inside the body, never in API paths or shell.
    body = (
        "Automated FISC data refresh. Review every added, removed and renamed institution.\n\n"
        "Only the CSV, generated browser JS and BIC manifest may change. "
        "No automatic merge. The update workflow validates the bundle twice.\n\n"
        "**GITHUB_TOKEN-created PRs normally do not trigger PR workflows.** "
        "Before merging, run the `test` workflow on this bot branch via the CLI "
        "(see docs/deployment-security.md), and wait for `verify` to pass.\n\n"
        "```json\n" + describe_change(previous, current) + "\n```\n"
    )
    pulls = api.request("GET", f"pulls?state=open&base=main&head=s950449:{BRANCH}")
    payload = {"title": "chore: update FISC BIC data", "body": body}
    if pulls:
        api.request("PATCH", f"pulls/{pulls[0]['number']}", payload)
    else:
        api.request("POST", "pulls", {**payload, "head": BRANCH, "base": "main"})
    print("Data-only PR ready. Human review and a successful verify check are required.")


def main():
    if os.environ.get("GH_REPO") != REPOSITORY:
        raise ValueError("Unexpected repository")
    base_sha = os.environ["BASE_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", base_sha):
        raise ValueError("Invalid base SHA")
    previous, current, content = validate_bundle(Path(os.environ["BUNDLE_DIR"]))
    publish(GitHub(os.environ["GH_TOKEN"]), base_sha, previous, current, content)


if __name__ == "__main__":
    main()
