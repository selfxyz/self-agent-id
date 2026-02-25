#!/usr/bin/env python3
# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent


def run_step(cmd: list[str], description: str) -> None:
    print(f"🔍 {description}...")
    result = subprocess.run(cmd, cwd=SCRIPT_DIR.parent)
    if result.returncode != 0:
        print(f"❌ {description} failed")
        raise SystemExit(result.returncode)


def main() -> int:
    parser = argparse.ArgumentParser(description="Run all license header checks")
    parser.add_argument(
        "--fix",
        action="store_true",
        help="Fix missing/malformed headers after duplicate check",
    )
    parser.add_argument(
        "dirs",
        nargs="*",
        help="Optional subset of directories to process",
    )
    args = parser.parse_args()

    duplicate_cmd = [sys.executable, str(SCRIPT_DIR / "check-duplicate-headers.py"), *args.dirs]
    license_cmd = [sys.executable, str(SCRIPT_DIR / "check-license-headers.py")]
    if args.fix:
        license_cmd.append("--fix")
    license_cmd.extend(args.dirs)

    run_step(duplicate_cmd, "Checking for duplicate license headers")
    run_step(license_cmd, "Fixing license headers" if args.fix else "Checking license headers")

    print("✅ All license header checks completed successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
