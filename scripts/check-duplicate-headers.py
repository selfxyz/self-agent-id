#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
import os

SCRIPT_DIR = Path(__file__).resolve().parent
CONFIG_PATH = SCRIPT_DIR / "license-header-config.json"
COPYRIGHT_RE = re.compile(r"^\s*(//|#|/\*+|\*+)\s*SPDX-FileCopyrightText:")
LICENSE_RE = re.compile(r"^\s*(//|#|/\*+|\*+)\s*SPDX-License-Identifier:")
HEADER_SCAN_LINE_LIMIT = 120


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def normalize_path(path: Path, repo_root: Path) -> str:
    return path.relative_to(repo_root).as_posix()


def iter_target_files(repo_root: Path, config: dict, requested_dirs: list[str] | None) -> list[Path]:
    include_dirs = requested_dirs if requested_dirs else config["include_dirs"]
    exclude_dir_names = set(config["exclude_dir_names"])
    exclude_prefixes = tuple(config["exclude_path_prefixes"])
    styles = config["extension_comment_style"]

    files: list[Path] = []
    for include_dir in include_dirs:
        start_dir = (repo_root / include_dir).resolve()
        if not start_dir.exists() or not start_dir.is_dir():
            continue

        for root, dirs, filenames in os.walk(start_dir, topdown=True):
            root_path = Path(root)
            rel_root = normalize_path(root_path, repo_root)

            dirs[:] = [
                d
                for d in dirs
                if d not in exclude_dir_names
                and not normalize_path(root_path / d, repo_root).startswith(exclude_prefixes)
            ]

            if rel_root.startswith(exclude_prefixes):
                dirs[:] = []
                continue

            for filename in filenames:
                path = root_path / filename
                rel_path = normalize_path(path, repo_root)
                if rel_path.startswith(exclude_prefixes):
                    continue
                if path.suffix.lower() not in styles:
                    continue
                files.append(path)

    return sorted(set(files))


def header_scan_start(lines: list[str]) -> int:
    i = 0
    if lines and lines[0].startswith("#!"):
        i = 1
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    return i


def main() -> int:
    parser = argparse.ArgumentParser(description="Check for duplicate SPDX copyright headers")
    parser.add_argument(
        "dirs",
        nargs="*",
        help="Optional subset of directories to process (default: config include_dirs).",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    config = load_config()
    files = iter_target_files(repo_root, config, args.dirs or None)

    has_errors = False
    for file in files:
        content = file.read_text(encoding="utf-8")
        lines = content.split("\n")
        start = header_scan_start(lines)
        scan_lines = lines[start : start + HEADER_SCAN_LINE_LIMIT]

        copyright_lines = [
            start + idx + 1
            for idx, line in enumerate(scan_lines)
            if COPYRIGHT_RE.search(line)
        ]
        license_lines = [
            start + idx + 1
            for idx, line in enumerate(scan_lines)
            if LICENSE_RE.search(line)
        ]

        if len(copyright_lines) <= 1 and len(license_lines) <= 1:
            continue

        has_errors = True
        rel = normalize_path(file, repo_root)
        print(f"\n❌ Multiple license headers found in {rel}:")
        for line_number in sorted(set(copyright_lines + license_lines)):
            print(f"   Line {line_number}")

    if has_errors:
        print("\n💡 Fix: keep only one canonical header block at the top of each file.\n")
        return 1

    print("✅ No duplicate license headers found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
