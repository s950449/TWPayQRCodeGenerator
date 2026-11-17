"""Ensure direct dependency edits cannot silently bypass the committed CI lock."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN = re.compile(r"^([A-Za-z0-9_.-]+)==([^\s;\\]+)")


def pins(text):
    return {match[1].lower().replace("_", "-"): match[2]
            for line in text.splitlines() if (match := PIN.match(line))}


def main():
    locked = pins((ROOT / "requirements-ci.lock").read_text())
    for name in ("requirements.txt", "requirements-ci.in"):
        for package, version in pins((ROOT / name).read_text()).items():
            if locked.get(package) != version:
                raise SystemExit(f"{name}: {package} pin differs from requirements-ci.lock")
    print("Python direct pins match the CI lock")


if __name__ == "__main__":
    main()
