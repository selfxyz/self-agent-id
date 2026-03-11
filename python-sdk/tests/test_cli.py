# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib import request

import pytest
from web3 import Web3

REPO_ROOT = Path(__file__).resolve().parents[2]
HARNESS_SCRIPT = REPO_ROOT / "scripts" / "local-registry-harness.sh"
LIVE = os.environ.get("SELF_AGENT_LIVE_TEST") == "1"
ANVIL_ALT_HUMAN_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"


def run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "self_agent_sdk.cli", *args],
        text=True,
        capture_output=True,
        check=False,
    )


def set_harness_agent(harness: dict, agent_address: str, agent_id: int, verified: bool = True) -> None:
    address_bytes = Web3.to_bytes(hexstr=Web3.to_checksum_address(agent_address))
    agent_key = "0x" + address_bytes.rjust(32, b"\x00").hex()
    set_cmd = subprocess.run(
        [
            str(HARNESS_SCRIPT),
            "set-agent",
            "--rpc-url",
            harness["rpcUrl"],
            "--registry",
            harness["registryAddress"],
            "--agent-key",
            agent_key,
            "--agent-id",
            str(agent_id),
            "--verified",
            "true" if verified else "false",
            "--private-key",
            harness["deployerPrivateKey"],
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    assert set_cmd.returncode == 0, set_cmd.stderr or set_cmd.stdout


def get_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


@pytest.fixture(scope="module")
def local_harness() -> dict:
    if not LIVE:
        pytest.skip("Set SELF_AGENT_LIVE_TEST=1 to run live CLI tests")

    harness_port = get_free_port()
    start = subprocess.run(
        [str(HARNESS_SCRIPT), "start", "--port", str(harness_port)],
        text=True,
        capture_output=True,
        check=False,
    )
    assert start.returncode == 0, start.stderr or start.stdout
    harness = json.loads(start.stdout)

    try:
        yield harness
    finally:
        subprocess.run(
            [str(HARNESS_SCRIPT), "stop", "--pid", str(harness["anvilPid"])],
            text=True,
            capture_output=True,
            check=False,
        )


def test_cli_init_open_export_roundtrip(tmp_path: Path):
    session = tmp_path / "session.json"

    init = run_cli(
        "register",
        "init",
        "--mode",
        "linked",
        "--human-address",
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "--network",
        "testnet",
        "--out",
        str(session),
    )
    assert init.returncode == 0, init.stderr
    assert session.exists()

    open_cmd = run_cli("register", "open", "--session", str(session))
    assert open_cmd.returncode == 0, open_cmd.stderr
    assert "/cli/register?payload=" in open_cmd.stdout

    blocked = run_cli("register", "export", "--session", str(session))
    assert blocked.returncode != 0

    key_path = tmp_path / "agent.key"
    export = run_cli(
        "register",
        "export",
        "--session",
        str(session),
        "--unsafe",
        "--out-key",
        str(key_path),
    )
    assert export.returncode == 0, export.stderr
    assert key_path.exists()


def test_cli_deregister_init_roundtrip(tmp_path: Path):
    session = tmp_path / "session-deregister.json"
    init = run_cli(
        "deregister",
        "init",
        "--mode",
        "linked",
        "--human-address",
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "--agent-address",
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "--network",
        "testnet",
        "--out",
        str(session),
    )
    assert init.returncode == 0, init.stderr
    data = json.loads(session.read_text(encoding="utf-8"))
    assert data["operation"] == "deregister"
    assert data["mode"] == "linked"
    assert data["registration"]["userDefinedData"].startswith("X")
    assert data.get("secrets") is None


@pytest.mark.slow
def test_cli_wait_live_verified_address(tmp_path: Path, local_harness: dict):
    session = tmp_path / "session.json"
    init = run_cli(
        "register",
        "init",
        "--mode",
        "self-custody",
        "--human-address",
        ANVIL_ALT_HUMAN_ADDRESS,
        "--chain",
        str(local_harness["chainId"]),
        "--registry",
        local_harness["registryAddress"],
        "--rpc",
        local_harness["rpcUrl"],
        "--out",
        str(session),
    )
    assert init.returncode == 0, init.stderr

    session_doc = json.loads(session.read_text(encoding="utf-8"))
    set_harness_agent(local_harness, session_doc["registration"]["agentAddress"], 201)

    wait = run_cli(
        "register",
        "wait",
        "--session",
        str(session),
        "--no-listener",
        "--timeout-seconds",
        "40",
        "--poll-ms",
        "2000",
    )
    assert wait.returncode == 0, wait.stderr
    assert '"agentId"' in wait.stdout


@pytest.mark.slow
def test_cli_wait_live_deregistered_address(tmp_path: Path, local_harness: dict):
    session = tmp_path / "session-deregister.json"
    init = run_cli(
        "deregister",
        "init",
        "--mode",
        "self-custody",
        "--human-address",
        local_harness["deployerAddress"],
        "--chain",
        str(local_harness["chainId"]),
        "--registry",
        local_harness["registryAddress"],
        "--rpc",
        local_harness["rpcUrl"],
        "--out",
        str(session),
    )
    assert init.returncode == 0, init.stderr

    session_doc = json.loads(session.read_text(encoding="utf-8"))
    set_harness_agent(local_harness, session_doc["registration"]["agentAddress"], 0, verified=False)

    wait = run_cli(
        "deregister",
        "wait",
        "--session",
        str(session),
        "--no-listener",
        "--timeout-seconds",
        "40",
        "--poll-ms",
        "2000",
    )
    assert wait.returncode == 0, wait.stderr
    assert '"stage": "onchain_deregistered"' in wait.stdout


@pytest.mark.slow
@pytest.mark.skipif(os.environ.get("SELF_AGENT_CALLBACK_TEST") != "1", reason="Set SELF_AGENT_CALLBACK_TEST=1")
def test_cli_wait_accepts_callback_payload(tmp_path: Path, local_harness: dict):
    callback_port = get_free_port()
    session_path = tmp_path / "session.json"
    init = run_cli(
        "register",
        "init",
        "--mode",
        "self-custody",
        "--human-address",
        local_harness["deployerAddress"],
        "--chain",
        str(local_harness["chainId"]),
        "--registry",
        local_harness["registryAddress"],
        "--rpc",
        local_harness["rpcUrl"],
        "--callback-port",
        str(callback_port),
        "--out",
        str(session_path),
    )
    assert init.returncode == 0, init.stderr

    session = json.loads(session_path.read_text(encoding="utf-8"))
    callback = session["callback"]
    callback_url = f"http://127.0.0.1:{callback['listenPort']}{callback['path']}"
    payload = {
        "sessionId": session["sessionId"],
        "stateToken": callback["stateToken"],
        "status": "success",
        "timestamp": int(time.time() * 1000),
    }

    proc = subprocess.Popen(
        [
            sys.executable,
            "-m",
            "self_agent_sdk.cli",
            "register",
            "wait",
            "--session",
            str(session_path),
            "--timeout-seconds",
            "40",
            "--poll-ms",
            "2000",
        ],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    try:
        body = json.dumps(payload).encode("utf-8")
        req = request.Request(
            callback_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        posted = False
        for _ in range(60):
            try:
                with request.urlopen(req, timeout=1.0) as res:
                    if res.status == 200:
                        posted = True
                        break
            except Exception:
                time.sleep(0.2)
        assert posted, "callback listener did not accept payload"

        set_harness_agent(local_harness, session["registration"]["agentAddress"], 202)

        stdout, stderr = proc.communicate(timeout=60)
        assert proc.returncode == 0, stderr
        assert '"callbackReceived": true' in stdout
    finally:
        if proc.poll() is None:
            proc.kill()
