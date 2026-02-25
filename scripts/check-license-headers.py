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

SPDX_COPYRIGHT_RE = re.compile(r"^\s*(//|#|/\*+|\*+)\s*SPDX-FileCopyrightText:")
SPDX_LICENSE_RE = re.compile(r"^\s*(//|#|/\*+|\*+)\s*SPDX-License-Identifier:")
CONVERSION_NOTE_RE = re.compile(r"^\s*(//|#|/\*+|\*+)\s*NOTE:\s*Converts to Apache-2\.0")
MALFORMED_SCAN_LINE_LIMIT = 16


class HeaderIssue:
    def __init__(self, file: Path, issue: str) -> None:
        self.file = file
        self.issue = issue


def load_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        return json.load(f)


def normalize_path(path: Path, repo_root: Path) -> str:
    return path.relative_to(repo_root).as_posix()


def template_name_for_path(rel_path: str, config: dict) -> str:
    for override in config.get("path_overrides", []):
        if rel_path.startswith(override["prefix"]):
            return override["template"]
    return config["default_template"]


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
                style = styles.get(path.suffix.lower())
                if style is None:
                    continue
                files.append(path)

    return sorted(set(files))


def canonical_lines(style: str, template_name: str, config: dict) -> list[str]:
    prefix = "//" if style == "slash" else "#"
    template = config["header_templates"][template_name]
    lines: list[str] = []
    if template.get("copyright"):
        lines.append(f"{prefix} SPDX-FileCopyrightText: {template['copyright']}")
    lines.append(f"{prefix} SPDX-License-Identifier: {template['license']}")
    if template.get("note"):
        lines.append(f"{prefix} NOTE: {template['note']}")
    return lines


def scan_top(lines: list[str]) -> tuple[int, int]:
    i = 0
    if lines and lines[0].startswith("#!"):
        i = 1
    while i < len(lines) and lines[i].strip() == "":
        i += 1
    return i, (1 if lines and lines[0].startswith("#!") else 0)


def is_spdxish(line: str) -> bool:
    return bool(
        SPDX_COPYRIGHT_RE.search(line)
        or SPDX_LICENSE_RE.search(line)
        or CONVERSION_NOTE_RE.search(line)
    )


def find_spdx_block(lines: list[str], start_idx: int) -> tuple[int, int] | None:
    if start_idx >= len(lines):
        return None

    if not is_spdxish(lines[start_idx]):
        return None

    end = start_idx
    while end + 1 < len(lines) and (is_spdxish(lines[end + 1]) or lines[end + 1].strip() == ""):
        end += 1

    while end >= start_idx and lines[end].strip() == "":
        end -= 1

    return (start_idx, end)


def ensure_single_blank_after_header(lines: list[str], start_idx: int, expected_len: int) -> list[str]:
    blank_idx = start_idx + expected_len
    if blank_idx >= len(lines):
        lines.append("")
    if lines[blank_idx] != "":
        lines.insert(blank_idx, "")
    while blank_idx + 1 < len(lines) and lines[blank_idx + 1] == "":
        del lines[blank_idx + 1]
    return lines


def analyze_file(path: Path, expected: list[str]) -> tuple[HeaderIssue | None, list[str]]:
    content = path.read_text(encoding="utf-8")
    lines = content.split("\n")

    start_idx, _ = scan_top(lines)
    expected_len = len(expected)
    expected_end = start_idx + expected_len - 1
    spdx_block = find_spdx_block(lines, start_idx)

    has_exact = (
        start_idx + expected_len - 1 < len(lines)
        and all(lines[start_idx + i] == expected[i] for i in range(expected_len))
    )

    if has_exact:
        if spdx_block is not None and spdx_block[1] > expected_end:
            return HeaderIssue(path, "Unexpected extra SPDX lines in header block"), lines
        if start_idx + expected_len >= len(lines) or lines[start_idx + expected_len] != "":
            return HeaderIssue(path, "Missing newline after license header"), lines
        if start_idx + expected_len + 1 < len(lines) and lines[start_idx + expected_len + 1] == "":
            return HeaderIssue(path, "Too many blank lines after license header"), lines
        return None, lines

    if spdx_block is not None:
        return HeaderIssue(path, "Incomplete or malformed license header"), lines

    malformed_scan_slice = lines[start_idx : start_idx + MALFORMED_SCAN_LINE_LIMIT]
    if any(is_spdxish(line) for line in malformed_scan_slice):
        return HeaderIssue(path, "Malformed top-of-file SPDX block"), lines

    return HeaderIssue(path, "Missing or incorrect license header"), lines


def apply_fix(lines: list[str], expected: list[str]) -> list[str]:
    start_idx, shebang_boundary = scan_top(lines)
    expected_len = len(expected)
    expected_end = start_idx + expected_len - 1
    spdx_block = find_spdx_block(lines, start_idx)

    has_exact = (
        start_idx + expected_len - 1 < len(lines)
        and all(lines[start_idx + i] == expected[i] for i in range(expected_len))
    )

    if has_exact:
        if spdx_block is not None and spdx_block[1] > expected_end:
            block_start, block_end = spdx_block
            replacement = [*expected, ""]
            updated = lines[:block_start] + replacement + lines[block_end + 1 :]
            return ensure_single_blank_after_header(updated, block_start, expected_len)
        return ensure_single_blank_after_header(lines, start_idx, expected_len)

    if spdx_block is not None:
        block_start, block_end = spdx_block
        replacement = [*expected, ""]
        updated = lines[:block_start] + replacement + lines[block_end + 1 :]
        return ensure_single_blank_after_header(updated, block_start, expected_len)

    insert_at = shebang_boundary
    replacement = [*expected, ""]
    updated = lines[:insert_at] + replacement + lines[insert_at:]
    return ensure_single_blank_after_header(updated, insert_at, expected_len)


def run(mode: str, dirs: list[str] | None) -> int:
    repo_root = Path(__file__).resolve().parents[1]
    config = load_config()
    styles = config["extension_comment_style"]
    files = iter_target_files(repo_root, config, dirs)

    issues: list[HeaderIssue] = []
    fixed = 0

    for file in files:
        style = styles[file.suffix.lower()]
        rel_path = normalize_path(file, repo_root)
        template_name = template_name_for_path(rel_path, config)
        expected = canonical_lines(style, template_name, config)
        issue, lines = analyze_file(file, expected)
        if issue is None:
            continue

        if mode == "fix":
            updated = apply_fix(lines, expected)
            new_content = "\n".join(updated)
            if not new_content.endswith("\n"):
                new_content += "\n"
            file.write_text(new_content, encoding="utf-8")
            fixed += 1
        else:
            issues.append(issue)

    if mode == "fix":
        print(f"✅ Fixed license headers in {fixed} file(s)")
        return 0

    if issues:
        print(f"❌ Found {len(issues)} file(s) with license header issues:\n")
        for issue in issues:
            rel = normalize_path(issue.file, repo_root)
            print(f"- {rel}: {issue.issue}")
        return 1

    print("✅ All license headers are properly formatted")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check or fix BUSL license headers across source files."
    )
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Apply in-place fixes instead of checking.",
    )
    parser.add_argument(
        "dirs",
        nargs="*",
        help="Optional subset of directories to process (default: config include_dirs).",
    )
    args = parser.parse_args()

    mode = "fix" if args.fix else "check"
    return run(mode, args.dirs or None)


if __name__ == "__main__":
    sys.exit(main())
