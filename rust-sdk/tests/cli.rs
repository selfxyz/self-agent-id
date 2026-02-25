// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::str::FromStr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;

fn cli_bin() -> &'static str {
    env!("CARGO_BIN_EXE_self-agent-cli")
}

const ANVIL_ALT_HUMAN_ADDRESS: &str = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn harness_script() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("scripts")
        .join("local-registry-harness.sh")
}

fn run_cli(args: &[&str]) -> std::process::Output {
    Command::new(cli_bin())
        .args(args)
        .output()
        .expect("failed to execute CLI")
}

fn assert_ok(output: &std::process::Output) {
    if !output.status.success() {
        panic!(
            "CLI failed\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalHarness {
    rpc_url: String,
    chain_id: u64,
    registry_address: String,
    anvil_pid: u64,
    deployer_private_key: String,
    deployer_address: String,
}

struct HarnessGuard {
    cfg: LocalHarness,
}

impl HarnessGuard {
    fn start() -> Self {
        let harness_port = free_port();
        let output = Command::new(harness_script())
            .args(["start", "--port", &harness_port.to_string()])
            .output()
            .expect("start local harness");
        assert_ok(&output);
        let cfg: LocalHarness =
            serde_json::from_slice(&output.stdout).expect("parse harness start output");
        Self { cfg }
    }

    fn config(&self) -> &LocalHarness {
        &self.cfg
    }

    fn set_agent(&self, agent_address: &str, agent_id: u64, verified: bool) {
        let addr =
            alloy::primitives::Address::from_str(agent_address).expect("valid agent address");
        let mut key = [0u8; 32];
        key[12..].copy_from_slice(addr.as_slice());
        let agent_key = format!("0x{}", hex::encode(key));

        let output = Command::new(harness_script())
            .args([
                "set-agent",
                "--rpc-url",
                &self.cfg.rpc_url,
                "--registry",
                &self.cfg.registry_address,
                "--agent-key",
                &agent_key,
                "--agent-id",
                &agent_id.to_string(),
                "--verified",
                if verified { "true" } else { "false" },
                "--private-key",
                &self.cfg.deployer_private_key,
            ])
            .output()
            .expect("set harness agent");
        assert_ok(&output);
    }
}

impl Drop for HarnessGuard {
    fn drop(&mut self) {
        let _ = Command::new(harness_script())
            .args(["stop", "--pid", &self.cfg.anvil_pid.to_string()])
            .output();
    }
}

fn temp_session_path() -> (PathBuf, PathBuf) {
    let nonce = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let uniq = format!(
        "self-agent-cli-{}-{}-{}",
        std::process::id(),
        nonce,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("time")
            .as_nanos()
    );
    let dir = std::env::temp_dir().join(uniq);
    fs::create_dir_all(&dir).expect("create temp dir");
    let session = dir.join("session.json");
    (dir, session)
}

fn free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind free port");
    listener.local_addr().expect("local addr").port()
}

fn read_json(path: &Path) -> serde_json::Value {
    let raw = fs::read_to_string(path).expect("read session json");
    serde_json::from_str(&raw).unwrap_or_else(|err| {
        panic!(
            "parse session json: {err}\npath: {}\nraw:\n{}",
            path.display(),
            raw
        )
    })
}

#[test]
fn cli_init_open_export_roundtrip() {
    let (tmp_dir, session) = temp_session_path();

    let init = run_cli(&[
        "register",
        "init",
        "--mode",
        "agent-identity",
        "--human-address",
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "--network",
        "testnet",
        "--out",
        &session.display().to_string(),
    ]);
    assert_ok(&init);
    assert!(session.exists(), "session file should exist");

    let open = run_cli(&[
        "register",
        "open",
        "--session",
        &session.display().to_string(),
    ]);
    assert_ok(&open);
    let open_stdout = String::from_utf8_lossy(&open.stdout);
    assert!(
        open_stdout.contains("/cli/register?payload="),
        "open output should contain handoff URL"
    );

    let blocked = run_cli(&[
        "register",
        "export",
        "--session",
        &session.display().to_string(),
    ]);
    assert!(
        !blocked.status.success(),
        "export without unsafe flag must fail"
    );

    let key_path = session.parent().unwrap().join("agent.key");
    let export = run_cli(&[
        "register",
        "export",
        "--session",
        &session.display().to_string(),
        "--unsafe",
        "--out-key",
        &key_path.display().to_string(),
    ]);
    assert_ok(&export);
    assert!(key_path.exists(), "exported key file should exist");
    let _ = fs::remove_dir_all(tmp_dir);
}

#[test]
fn cli_deregister_init_roundtrip() {
    let (tmp_dir, session) = temp_session_path();

    let init = run_cli(&[
        "deregister",
        "init",
        "--mode",
        "agent-identity",
        "--human-address",
        "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
        "--agent-address",
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "--network",
        "testnet",
        "--out",
        &session.display().to_string(),
    ]);
    assert_ok(&init);
    assert!(session.exists(), "session file should exist");

    let session_json = read_json(&session);
    assert_eq!(
        session_json["operation"].as_str(),
        Some("deregister"),
        "operation should be deregister"
    );
    assert_eq!(
        session_json["mode"].as_str(),
        Some("agent-identity"),
        "mode should be agent-identity"
    );
    let user_data = session_json["registration"]["userDefinedData"]
        .as_str()
        .unwrap_or_default();
    assert!(
        user_data.starts_with('X'),
        "deregister agent-identity should encode X* user data"
    );
    assert!(
        session_json["secrets"].is_null(),
        "deregister sessions should not contain generated private key"
    );

    let _ = fs::remove_dir_all(tmp_dir);
}

#[test]
#[ignore]
fn cli_wait_live_verified_address() {
    let harness = HarnessGuard::start();
    let cfg = harness.config();
    let (tmp_dir, session) = temp_session_path();
    let init = run_cli(&[
        "register",
        "init",
        "--mode",
        "verified-wallet",
        "--human-address",
        ANVIL_ALT_HUMAN_ADDRESS,
        "--chain",
        &cfg.chain_id.to_string(),
        "--registry",
        &cfg.registry_address,
        "--rpc",
        &cfg.rpc_url,
        "--out",
        &session.display().to_string(),
    ]);
    assert_ok(&init);

    let session_json = read_json(&session);
    let agent_address = session_json["registration"]["agentAddress"]
        .as_str()
        .expect("agentAddress");
    harness.set_agent(agent_address, 301, true);

    let wait = run_cli(&[
        "register",
        "wait",
        "--session",
        &session.display().to_string(),
        "--no-listener",
        "--timeout-seconds",
        "40",
        "--poll-ms",
        "2000",
    ]);
    assert_ok(&wait);
    let out = String::from_utf8_lossy(&wait.stdout);
    assert!(
        out.contains("\"agentId\""),
        "wait output should include agentId"
    );
    let _ = fs::remove_dir_all(tmp_dir);
}

#[test]
#[ignore]
fn cli_wait_accepts_callback_payload() {
    let harness = HarnessGuard::start();
    let cfg = harness.config();
    let (tmp_dir, session_path) = temp_session_path();
    let callback_port = free_port();
    let init = run_cli(&[
        "register",
        "init",
        "--mode",
        "verified-wallet",
        "--human-address",
        &cfg.deployer_address,
        "--chain",
        &cfg.chain_id.to_string(),
        "--registry",
        &cfg.registry_address,
        "--rpc",
        &cfg.rpc_url,
        "--callback-port",
        &callback_port.to_string(),
        "--out",
        &session_path.display().to_string(),
    ]);
    assert_ok(&init);

    let session = read_json(&session_path);
    let callback = &session["callback"];
    let port = callback["listenPort"].as_u64().expect("listenPort") as u16;
    let path = callback["path"].as_str().expect("path");
    let session_id = session["sessionId"].as_str().expect("sessionId");
    let token = callback["stateToken"].as_str().expect("stateToken");

    let child = Command::new(cli_bin())
        .args([
            "register",
            "wait",
            "--session",
            &session_path.display().to_string(),
            "--timeout-seconds",
            "40",
            "--poll-ms",
            "2000",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn wait command");

    let body = serde_json::json!({
        "sessionId": session_id,
        "stateToken": token,
        "status": "success",
        "timestamp": 1_700_000_000_000u64,
    })
    .to_string();

    let mut posted = false;
    for _ in 0..80 {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) {
            let req = format!(
                "POST {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                path,
                port,
                body.len(),
                body
            );
            let _ = stream.write_all(req.as_bytes());
            let mut resp = String::new();
            let _ = stream.read_to_string(&mut resp);
            if resp.contains("200") {
                posted = true;
                break;
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    assert!(posted, "callback listener did not accept payload");

    let agent_address = session["registration"]["agentAddress"]
        .as_str()
        .expect("agentAddress");
    harness.set_agent(agent_address, 302, true);

    let output = child.wait_with_output().expect("wait output");
    assert_ok(&output);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("\"callbackReceived\": true"),
        "wait output should mark callbackReceived true"
    );
    let _ = fs::remove_dir_all(tmp_dir);
}

#[test]
#[ignore]
fn cli_wait_live_deregistered_address() {
    let harness = HarnessGuard::start();
    let cfg = harness.config();
    let (tmp_dir, session) = temp_session_path();
    let init = run_cli(&[
        "deregister",
        "init",
        "--mode",
        "verified-wallet",
        "--human-address",
        &cfg.deployer_address,
        "--chain",
        &cfg.chain_id.to_string(),
        "--registry",
        &cfg.registry_address,
        "--rpc",
        &cfg.rpc_url,
        "--out",
        &session.display().to_string(),
    ]);
    assert_ok(&init);

    let session_json = read_json(&session);
    let agent_address = session_json["registration"]["agentAddress"]
        .as_str()
        .expect("agentAddress");
    harness.set_agent(agent_address, 0, false);

    let wait = run_cli(&[
        "deregister",
        "wait",
        "--session",
        &session.display().to_string(),
        "--no-listener",
        "--timeout-seconds",
        "40",
        "--poll-ms",
        "2000",
    ]);
    assert_ok(&wait);
    let out = String::from_utf8_lossy(&wait.stdout);
    assert!(
        out.contains("\"stage\": \"onchain_deregistered\""),
        "wait output should include onchain_deregistered stage"
    );
    let _ = fs::remove_dir_all(tmp_dir);
}
