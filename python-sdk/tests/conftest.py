# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import pytest


def pytest_addoption(parser):
    parser.addoption("--slow", action="store_true", default=False, help="Run slow integration tests")


def pytest_configure(config):
    config.addinivalue_line("markers", "slow: mark test as slow (needs network)")


def pytest_collection_modifyitems(config, items):
    if not config.getoption("--slow"):
        skip_slow = pytest.mark.skip(reason="Need --slow option to run")
        for item in items:
            if "slow" in item.keywords:
                item.add_marker(skip_slow)
