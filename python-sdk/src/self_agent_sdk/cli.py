"""Self Agent CLI (Python)."""
from __future__ import annotations

import argparse
import base64
import json
import os
import secrets
import sys
import threading
import time
from datetime import datetime, timezone
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from eth_account import Account
from web3 import Web3

from ._signing import address_to_agent_key
from .constants import NETWORKS, REGISTRY_ABI
from .registration import (
    build_advanced_deregister_user_data_ascii,
    build_advanced_register_user_data_ascii,
    build_simple_deregister_user_data_ascii,
    build_simple_register_user_data_ascii,
    build_wallet_free_register_user_data_ascii,
    get_registration_config_index,
    sign_registration_challenge,
)

DEFAULT_APP_URL = os.environ.get("SELF_AGENT_APP_URL", "https://self-agent-id.vercel.app")
DEFAULT_APP_NAME = os.environ.get("SELF_AGENT_APP_NAME", "Self Agent ID")
DEFAULT_SCOPE = os.environ.get("SELF_AGENT_SCOPE", "self-agent-id")
DEMO_VERIFIED_ADDRESS = "0x83fa4380903fecb801F4e123835664973001ff00"


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"


def _secure_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(text)


def _secure_write_json(path: Path, payload: dict[str, Any]) -> None:
    _secure_write_text(path, json.dumps(payload, indent=2) + "\n")


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _to_checksum(address: str) -> str:
    return Web3.to_checksum_address(address)


def _random_hex(bytes_len: int = 16) -> str:
    return secrets.token_hex(bytes_len)


def _parse_disclosures(args: argparse.Namespace) -> dict[str, Any]:
    minimum_age = int(args.minimum_age or 0)
    if minimum_age not in (0, 18, 21):
        raise SystemExit("--minimum-age must be 0, 18, or 21")

    return {
        "minimumAge": minimum_age,
        "ofac": bool(args.ofac),
        "nationality": bool(args.nationality),
        "name": bool(args.name),
        "date_of_birth": bool(args.date_of_birth),
        "gender": bool(args.gender),
        "issuing_state": bool(args.issuing_state),
    }


def _parse_network(args: argparse.Namespace) -> dict[str, Any]:
    app_url = (args.app_url or DEFAULT_APP_URL).rstrip("/")
    app_name = args.app_name or DEFAULT_APP_NAME
    scope = args.scope or DEFAULT_SCOPE

    if args.chain is not None:
        if not args.registry:
            raise SystemExit("--registry is required when --chain is provided")
        if not args.rpc:
            raise SystemExit("--rpc is required when --chain is provided")
        chain_id = int(args.chain)
        return {
            "chainId": chain_id,
            "rpcUrl": str(args.rpc),
            "registryAddress": _to_checksum(str(args.registry)),
            "endpointType": "celo" if chain_id == 42220 else "staging_celo",
            "appUrl": app_url,
            "appName": app_name,
            "scope": scope,
        }

    network = (args.network or "testnet").lower()
    if network not in ("mainnet", "testnet"):
        raise SystemExit(f"Unsupported network: {network}")
    cfg = NETWORKS[network]  # type: ignore[index]
    return {
        "chainId": 42220 if network == "mainnet" else 11142220,
        "rpcUrl": cfg["rpc_url"],
        "registryAddress": cfg["registry_address"],
        "endpointType": "celo" if network == "mainnet" else "staging_celo",
        "appUrl": app_url,
        "appName": app_name,
        "scope": scope,
    }


def _callback_url(session: dict[str, Any]) -> str:
    cb = session["callback"]
    return f"http://{cb['listenHost']}:{cb['listenPort']}{cb['path']}"


def _get_session_operation(session: dict[str, Any]) -> str:
    return str(session.get("operation") or "register")


def _handoff_url(session: dict[str, Any]) -> str:
    payload = {
        "version": 1,
        "operation": _get_session_operation(session),
        "sessionId": session["sessionId"],
        "stateToken": session["callback"]["stateToken"],
        "callbackUrl": _callback_url(session),
        "mode": session["mode"],
        "chainId": session["network"]["chainId"],
        "registryAddress": session["network"]["registryAddress"],
        "endpointType": session["network"]["endpointType"],
        "appName": session["network"]["appName"],
        "scope": session["network"]["scope"],
        "humanIdentifier": session["registration"]["humanIdentifier"],
        "expectedAgentAddress": session["registration"]["agentAddress"],
        "disclosures": session.get("disclosures", {}),
        "userDefinedData": session["registration"].get("userDefinedData"),
        "smartWalletTemplate": session["registration"].get("smartWalletTemplate"),
        "expiresAt": int(
            datetime.fromisoformat(session["expiresAt"].replace("Z", "+00:00"))
            .astimezone(timezone.utc)
            .timestamp()
            * 1000
        ),
    }
    encoded = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode("utf-8")
    ).decode("utf-8").rstrip("=")
    return f"{session['network']['appUrl']}/cli/register?payload={encoded}"


def _save_session(path: Path, session: dict[str, Any]) -> None:
    session["state"]["updatedAt"] = _now_iso()
    _secure_write_json(path, session)


def cmd_register_init(args: argparse.Namespace) -> None:
    cmd_init(args, "register")


def cmd_deregister_init(args: argparse.Namespace) -> None:
    cmd_init(args, "deregister")


def cmd_init(args: argparse.Namespace, operation: str) -> None:
    mode = args.mode
    network = _parse_network(args)
    disclosures = _parse_disclosures(args)
    cfg_idx = get_registration_config_index(disclosures)

    ttl_minutes = int(args.ttl_minutes or 30)
    if ttl_minutes <= 0:
        raise SystemExit("--ttl-minutes must be > 0")

    out = Path(args.out or f".self/session-{_random_hex(8)}.json").resolve()
    created_at = _now_iso()
    expires_at = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(time.time() + ttl_minutes * 60),
    )

    human_identifier = ""
    agent_address = ""
    user_defined_data: str | None = None
    challenge_hash: str | None = None
    signature: dict[str, Any] | None = None
    smart_wallet_template: dict[str, Any] | None = None
    agent_private_key: str | None = None

    if mode in ("verified-wallet", "agent-identity", "privy"):
        if not args.human_address:
            raise SystemExit("--human-address is required for verified-wallet, agent-identity, and privy")
        human_identifier = _to_checksum(args.human_address)

    if operation == "register":
        if mode == "verified-wallet":
            agent_address = human_identifier
            user_defined_data = build_simple_register_user_data_ascii(disclosures)
        else:
            acct = Account.create()
            agent_private_key = "0x" + acct.key.hex()
            agent_address = _to_checksum(acct.address)
            if mode in ("wallet-free", "smart-wallet"):
                human_identifier = agent_address

            signed = sign_registration_challenge(
                private_key=agent_private_key,
                human_identifier=human_identifier,
                chain_id=int(network["chainId"]),
                registry_address=str(network["registryAddress"]),
            )
            challenge_hash = signed.message_hash
            signature = {"r": signed.r, "s": signed.s, "v": signed.v}

            if mode in ("agent-identity", "privy"):
                user_defined_data = build_advanced_register_user_data_ascii(
                    agent_address=agent_address,
                    signature_r=signed.r,
                    signature_s=signed.s,
                    signature_v=signed.v,
                    disclosures=disclosures,
                )
            elif mode == "wallet-free":
                user_defined_data = build_wallet_free_register_user_data_ascii(
                    agent_address=agent_address,
                    signature_r=signed.r,
                    signature_s=signed.s,
                    signature_v=signed.v,
                    disclosures=disclosures,
                )
            elif mode == "smart-wallet":
                smart_wallet_template = {
                    "agentAddress": agent_address,
                    "r": signed.r,
                    "s": signed.s,
                    "v": signed.v,
                    "configIndex": cfg_idx,
                }
    else:
        if mode == "verified-wallet":
            agent_address = human_identifier
            user_defined_data = build_simple_deregister_user_data_ascii(disclosures)
        elif mode in ("agent-identity", "privy"):
            if not args.agent_address:
                raise SystemExit("--agent-address is required for agent-identity/privy deregistration")
            agent_address = _to_checksum(args.agent_address)
            user_defined_data = build_advanced_deregister_user_data_ascii(
                agent_address=agent_address,
                disclosures=disclosures,
            )
        elif mode in ("wallet-free", "smart-wallet"):
            if not args.agent_address:
                raise SystemExit(
                    "--agent-address is required for wallet-free and smart-wallet deregistration"
                )
            agent_address = _to_checksum(args.agent_address)
            human_identifier = agent_address
            user_defined_data = build_simple_deregister_user_data_ascii(disclosures)

    callback_port = int(args.callback_port) if args.callback_port else (37100 + secrets.randbelow(900))

    session: dict[str, Any] = {
        "version": 1,
        "operation": operation,
        "sessionId": _random_hex(16),
        "createdAt": created_at,
        "expiresAt": expires_at,
        "mode": mode,
        "disclosures": disclosures,
        "network": network,
        "registration": {
            "humanIdentifier": human_identifier,
            "agentAddress": agent_address,
            "userDefinedData": user_defined_data,
            "challengeHash": challenge_hash,
            "signature": signature,
            "smartWalletTemplate": smart_wallet_template,
        },
        "callback": {
            "listenHost": "127.0.0.1",
            "listenPort": callback_port,
            "path": "/callback",
            "stateToken": _random_hex(24),
            "used": False,
        },
        "state": {"stage": "initialized", "updatedAt": created_at},
        "secrets": {"agentPrivateKey": agent_private_key} if agent_private_key else None,
    }

    _secure_write_json(out, session)
    print(
        json.dumps(
            {
                "ok": True,
                "sessionPath": str(out),
                "sessionId": session["sessionId"],
                "operation": operation,
                "mode": mode,
                "agentAddress": agent_address,
                "callbackUrl": _callback_url(session),
                "next": [
                    f"python -m self_agent_sdk.cli {operation} open --session {out}",
                    f"python -m self_agent_sdk.cli {operation} wait --session {out}",
                ],
            },
            indent=2,
        )
    )


def cmd_register_open(args: argparse.Namespace) -> None:
    cmd_open(args)


def cmd_deregister_open(args: argparse.Namespace) -> None:
    cmd_open(args)


def cmd_open(args: argparse.Namespace) -> None:
    session_path = Path(args.session).resolve()
    session = _read_json(session_path)
    operation = _get_session_operation(session)
    if time.time() > datetime.fromisoformat(session["expiresAt"].replace("Z", "+00:00")).timestamp():
        session["state"]["stage"] = "expired"
        session["state"]["lastError"] = "Session expired"
        _save_session(session_path, session)
        raise SystemExit(f"Session expired. Run `{operation} init` again.")
    url = _handoff_url(session)
    session["state"]["stage"] = "handoff_opened"
    _save_session(session_path, session)
    print(
        json.dumps(
            {
                "ok": True,
                "sessionPath": str(session_path),
                "operation": operation,
                "url": url,
                "callbackUrl": _callback_url(session),
            },
            indent=2,
        )
    )


@dataclass
class CallbackState:
    used: bool = False
    error: str | None = None
    guardian_address: str | None = None


def _make_handler(session: dict[str, Any], session_path: Path, state: CallbackState):
    class Handler(BaseHTTPRequestHandler):
        def _respond(self, code: int, payload: dict[str, Any]) -> None:
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.end_headers()
            self.wfile.write(json.dumps(payload).encode("utf-8"))

        def do_OPTIONS(self) -> None:  # noqa: N802
            self._respond(204, {"ok": True})

        def do_POST(self) -> None:  # noqa: N802
            if self.path.split("?")[0] != session["callback"]["path"]:
                self._respond(404, {"error": "Not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                body_raw = self.rfile.read(length).decode("utf-8") if length else "{}"
                body = json.loads(body_raw)
                if body.get("sessionId") != session["sessionId"]:
                    self._respond(400, {"error": "Session mismatch"})
                    return
                if body.get("stateToken") != session["callback"]["stateToken"]:
                    self._respond(401, {"error": "Invalid state token"})
                    return
                if state.used:
                    self._respond(409, {"error": "Callback already used"})
                    return

                state.used = True
                session["callback"]["used"] = True
                status = body.get("status", "success")
                session["callback"]["lastStatus"] = "error" if status == "error" else "success"

                if status == "error":
                    state.error = str(body.get("error") or "Browser callback error")
                    session["callback"]["lastError"] = state.error
                    session["state"]["stage"] = "failed"
                    session["state"]["lastError"] = state.error
                else:
                    session["state"]["stage"] = "callback_received"
                    guardian = body.get("guardianAddress")
                    if guardian:
                        state.guardian_address = _to_checksum(str(guardian))
                        session["state"]["guardianAddress"] = state.guardian_address

                _save_session(session_path, session)
                self._respond(200, {"ok": True})
            except Exception as exc:  # pragma: no cover - defensive
                self._respond(400, {"error": str(exc)})

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            return

    return Handler


def cmd_register_wait(args: argparse.Namespace) -> None:
    cmd_wait(args)


def cmd_deregister_wait(args: argparse.Namespace) -> None:
    cmd_wait(args)


def cmd_wait(args: argparse.Namespace) -> None:
    session_path = Path(args.session).resolve()
    session = _read_json(session_path)
    operation = _get_session_operation(session)

    timeout_seconds = int(args.timeout_seconds or 1800)
    poll_ms = int(args.poll_ms or 4000)
    if timeout_seconds <= 0:
        raise SystemExit("--timeout-seconds must be > 0")
    if poll_ms <= 0:
        raise SystemExit("--poll-ms must be > 0")

    if time.time() > datetime.fromisoformat(session["expiresAt"].replace("Z", "+00:00")).timestamp():
        session["state"]["stage"] = "expired"
        session["state"]["lastError"] = "Session expired"
        _save_session(session_path, session)
        raise SystemExit(f"Session expired. Run `{operation} init` again.")

    if args.open:
        print(_handoff_url(session))
        session["state"]["stage"] = "handoff_opened"
        _save_session(session_path, session)

    callback_state = CallbackState()
    listener_enabled = not bool(getattr(args, "no_listener", False))
    server: ThreadingHTTPServer | None = None

    if listener_enabled:
        handler = _make_handler(session, session_path, callback_state)
        try:
            server = ThreadingHTTPServer(
                (session["callback"]["listenHost"], int(session["callback"]["listenPort"])),
                handler,
            )
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
        except OSError as exc:
            listener_enabled = False
            print(
                f"Callback listener unavailable ({exc}). Continuing with on-chain polling only.",
                file=sys.stderr,
            )

    try:
        w3 = Web3(Web3.HTTPProvider(session["network"]["rpcUrl"]))
        registry = w3.eth.contract(
            address=_to_checksum(session["network"]["registryAddress"]),
            abi=REGISTRY_ABI,
        )
        agent_key = address_to_agent_key(session["registration"]["agentAddress"])

        deadline = time.time() + timeout_seconds
        verified = False
        agent_id = 0
        last_poll_error = ""

        while time.time() < deadline:
            if callback_state.error:
                session["state"]["stage"] = "failed"
                session["state"]["lastError"] = callback_state.error
                _save_session(session_path, session)
                raise SystemExit(
                    f"{'Registration' if operation == 'register' else 'Deregistration'} failed via callback: {callback_state.error}"
                )

            try:
                verified = bool(registry.functions.isVerifiedAgent(agent_key).call())
                agent_id = int(registry.functions.getAgentId(agent_key).call())
                onchain_verified = verified and agent_id > 0
                onchain_deregistered = (not verified) and agent_id == 0
                reached_target = onchain_verified if operation == "register" else onchain_deregistered

                if reached_target:
                    session["state"]["stage"] = (
                        "onchain_verified" if operation == "register" else "onchain_deregistered"
                    )
                    if operation == "register":
                        session["state"]["agentId"] = str(agent_id)
                    else:
                        session["state"].pop("agentId", None)
                    session["state"]["lastError"] = None
                    if callback_state.guardian_address:
                        session["state"]["guardianAddress"] = callback_state.guardian_address
                    _save_session(session_path, session)
                    print(
                        json.dumps(
                            {
                                "ok": True,
                                "sessionPath": str(session_path),
                                "operation": operation,
                                "stage": session["state"]["stage"],
                                "agentAddress": session["registration"]["agentAddress"],
                                "agentId": str(agent_id) if operation == "register" else None,
                                "callbackReceived": bool(session["callback"]["used"]),
                                "callbackListener": listener_enabled,
                                "guardianAddress": session["state"].get("guardianAddress"),
                            },
                            indent=2,
                        )
                    )
                    return
            except Exception as exc:  # pragma: no cover - network/env dependent
                last_poll_error = str(exc)

            time.sleep(poll_ms / 1000.0)

        session["state"]["stage"] = "expired"
        session["state"]["lastError"] = last_poll_error or f"Timed out waiting for on-chain {operation}"
        _save_session(session_path, session)
        raise SystemExit(
            f"Timed out waiting for on-chain {operation}. Last poll error: {last_poll_error or 'none'}"
        )
    finally:
        if server is not None:
            server.shutdown()
            server.server_close()


def cmd_register_status(args: argparse.Namespace) -> None:
    cmd_status(args)


def cmd_deregister_status(args: argparse.Namespace) -> None:
    cmd_status(args)


def cmd_status(args: argparse.Namespace) -> None:
    session_path = Path(args.session).resolve()
    session = _read_json(session_path)
    operation = _get_session_operation(session)
    print(
        json.dumps(
            {
                "ok": True,
                "sessionPath": str(session_path),
                "sessionId": session["sessionId"],
                "operation": operation,
                "mode": session["mode"],
                "stage": session["state"]["stage"],
                "expiresAt": session["expiresAt"],
                "agentAddress": session["registration"]["agentAddress"],
                "agentId": session["state"].get("agentId"),
                "callbackUrl": _callback_url(session),
                "callbackUsed": session["callback"]["used"],
                "lastError": session["state"].get("lastError"),
            },
            indent=2,
        )
    )


def cmd_register_export(args: argparse.Namespace) -> None:
    session_path = Path(args.session).resolve()
    session = _read_json(session_path)
    private_key = (session.get("secrets") or {}).get("agentPrivateKey")
    if not private_key:
        raise SystemExit("No agent private key in this session.")
    if not args.unsafe:
        raise SystemExit("Export blocked. Re-run with --unsafe.")

    printed = False
    exported_to = None

    if args.out_key:
        out_key = Path(args.out_key).resolve()
        _secure_write_text(out_key, private_key + "\n")
        exported_to = str(out_key)
    if args.print_private_key:
        print(private_key)
        printed = True

    if not printed and not exported_to:
        raise SystemExit("Nothing to export. Provide --out-key or --print-private-key.")

    print(
        json.dumps(
            {
                "ok": True,
                "sessionPath": str(session_path),
                "exportedTo": exported_to,
                "printed": printed,
            },
            indent=2,
        )
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="self-agent")
    sub = parser.add_subparsers(dest="command", required=True)

    register = sub.add_parser("register", help="Registration workflows")
    reg_sub = register.add_subparsers(dest="register_command", required=True)

    init = reg_sub.add_parser("init", help="Create registration session")
    init.add_argument("--mode", required=True, choices=["verified-wallet", "agent-identity", "wallet-free", "smart-wallet", "privy"])
    init.add_argument("--human-address")
    init.add_argument("--agent-address")
    init.add_argument("--network", default="testnet", choices=["mainnet", "testnet"])
    init.add_argument("--chain", type=int)
    init.add_argument("--registry")
    init.add_argument("--rpc")
    init.add_argument("--app-url")
    init.add_argument("--app-name")
    init.add_argument("--scope")
    init.add_argument("--out")
    init.add_argument("--callback-port", type=int)
    init.add_argument("--ttl-minutes", type=int, default=30)
    init.add_argument("--minimum-age", type=int, default=0)
    init.add_argument("--ofac", action="store_true")
    init.add_argument("--nationality", action="store_true")
    init.add_argument("--name", action="store_true")
    init.add_argument("--date-of-birth", dest="date_of_birth", action="store_true")
    init.add_argument("--gender", action="store_true")
    init.add_argument("--issuing-state", dest="issuing_state", action="store_true")
    init.set_defaults(func=cmd_register_init)

    open_cmd = reg_sub.add_parser("open", help="Print browser handoff URL")
    open_cmd.add_argument("--session", required=True)
    open_cmd.add_argument("--launch", action="store_true")
    open_cmd.set_defaults(func=cmd_open)

    wait_cmd = reg_sub.add_parser("wait", help="Wait for callback + on-chain verify")
    wait_cmd.add_argument("--session", required=True)
    wait_cmd.add_argument("--timeout-seconds", type=int, default=1800)
    wait_cmd.add_argument("--poll-ms", type=int, default=4000)
    wait_cmd.add_argument("--open", action="store_true")
    wait_cmd.add_argument("--no-listener", action="store_true")
    wait_cmd.set_defaults(func=cmd_wait)

    status = reg_sub.add_parser("status", help="Show session status")
    status.add_argument("--session", required=True)
    status.set_defaults(func=cmd_status)

    export_cmd = reg_sub.add_parser("export", help="Export generated private key")
    export_cmd.add_argument("--session", required=True)
    export_cmd.add_argument("--unsafe", action="store_true")
    export_cmd.add_argument("--out-key")
    export_cmd.add_argument("--print-private-key", action="store_true")
    export_cmd.set_defaults(func=cmd_register_export)

    deregister = sub.add_parser("deregister", help="Deregistration workflows")
    dreg_sub = deregister.add_subparsers(dest="deregister_command", required=True)

    dinit = dreg_sub.add_parser("init", help="Create deregistration session")
    dinit.add_argument("--mode", required=True, choices=["verified-wallet", "agent-identity", "wallet-free", "smart-wallet", "privy"])
    dinit.add_argument("--human-address")
    dinit.add_argument("--agent-address")
    dinit.add_argument("--network", default="testnet", choices=["mainnet", "testnet"])
    dinit.add_argument("--chain", type=int)
    dinit.add_argument("--registry")
    dinit.add_argument("--rpc")
    dinit.add_argument("--app-url")
    dinit.add_argument("--app-name")
    dinit.add_argument("--scope")
    dinit.add_argument("--out")
    dinit.add_argument("--callback-port", type=int)
    dinit.add_argument("--ttl-minutes", type=int, default=30)
    dinit.add_argument("--minimum-age", type=int, default=0)
    dinit.add_argument("--ofac", action="store_true")
    dinit.add_argument("--nationality", action="store_true")
    dinit.add_argument("--name", action="store_true")
    dinit.add_argument("--date-of-birth", dest="date_of_birth", action="store_true")
    dinit.add_argument("--gender", action="store_true")
    dinit.add_argument("--issuing-state", dest="issuing_state", action="store_true")
    dinit.set_defaults(func=cmd_deregister_init)

    dopen = dreg_sub.add_parser("open", help="Print browser handoff URL")
    dopen.add_argument("--session", required=True)
    dopen.add_argument("--launch", action="store_true")
    dopen.set_defaults(func=cmd_open)

    dwait = dreg_sub.add_parser("wait", help="Wait for callback + on-chain deregister")
    dwait.add_argument("--session", required=True)
    dwait.add_argument("--timeout-seconds", type=int, default=1800)
    dwait.add_argument("--poll-ms", type=int, default=4000)
    dwait.add_argument("--open", action="store_true")
    dwait.add_argument("--no-listener", action="store_true")
    dwait.set_defaults(func=cmd_wait)

    dstatus = dreg_sub.add_parser("status", help="Show session status")
    dstatus.add_argument("--session", required=True)
    dstatus.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
