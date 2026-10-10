"""Read-only SHA-256 freshness check for docs/ARCHITECTURE.md.

Standard library only. Does not import the app, open hardware, or use the network.
Exit 0: selected sources match; 1: changed/missing/new code; 2: invalid input/IO.
"""

import argparse
import hashlib
import json
from pathlib import Path
import sys


def inside(root: Path, relative: str) -> Path:
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError(f"indexed path escapes repository: {relative}")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--topic", action="append", help="check one group; repeat for several")
    parser.add_argument("--list", action="store_true", help="list available groups only")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1],
                        help="repository root; defaults to this script's checkout")
    args = parser.parse_args()
    root = args.root.resolve()
    try:
        index = json.loads(inside(root, "docs/ARCHITECTURE_INDEX.json").read_text(encoding="utf-8-sig"))
        if index["schema_version"] != 1:
            raise ValueError("unsupported index schema")
        groups = index["groups"]
        if args.list:
            print("Topics: " + ", ".join(groups))
            return 0
        selected = list(dict.fromkeys(args.topic or groups))
        unknown = set(selected) - groups.keys()
        if unknown:
            parser.error("unknown topic(s): " + ", ".join(sorted(unknown)))
        # Always validate the cached notes and this checker as well.
        if "reference" in groups and "reference" not in selected:
            selected.append("reference")
        hashes = {}
        stale = False
        for topic in selected:
            differences = []
            files = groups[topic]["files"]
            for relative, expected in files.items():
                if relative not in hashes:
                    path = inside(root, relative)
                    hashes[relative] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
                actual = hashes[relative]
                if actual != expected:
                    differences.append(("MISSING" if actual is None else "CHANGED", relative))
            if differences:
                stale = True
                for state, relative in differences:
                    print(f"{state} [{topic}] {relative}")
            else:
                print(f"CURRENT [{topic}] {len(files)} files")
        known = {relative for group in groups.values() for relative in group["files"]}
        discovered = set()
        for pattern in index.get("inventory_globs", []):
            for path in root.glob(pattern):
                if path.is_file():
                    relative = path.relative_to(root).as_posix()
                    inside(root, relative)
                    discovered.add(relative)
        for relative in sorted(discovered - known):
            stale = True
            print(f"NEW [unindexed source; topic unknown] {relative}")
        if stale:
            print("Review relevant changes; update notes and index together. No files were modified.")
        else:
            print("Selected sources match the reference. Runtime/provider readiness is not checked.")
        return 1 if stale else 0
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"Architecture index error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
