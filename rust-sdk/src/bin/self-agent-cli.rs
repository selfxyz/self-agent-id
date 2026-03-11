// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

use alloy::primitives::Address;
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use base64::Engine;
use self_agent_sdk::agent::address_to_agent_key;
use self_agent_sdk::constants::{network_config, IAgentRegistry, NetworkName};
use self_agent_sdk::registration::{
    RegistrationDisclosures, SignatureParts,
    build_advanced_deregister_user_data_ascii, build_advanced_register_user_data_ascii,
    build_simple_deregister_user_data_ascii, build_simple_register_user_data_ascii,
    build_wallet_free_register_user_data_ascii, get_registration_config_index,
    sign_registration_challenge,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs::{read_to_string, File, OpenOptions};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const DEFAULT_APP_URL: &str = "https://self-agent-id.vercel.app";
const DEFAULT_APP_NAME: &str = "Self Agent ID";
const DEFAULT_SCOPE: &str = "self-agent-id";
const OP_REGISTER: &str = "register";
const OP_DEREGISTER: &str = "deregister";

fn default_operation() -> String {
    OP_REGISTER.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Disclosures {
    minimum_age: u8,
    ofac: bool,
    nationality: bool,
    name: bool,
    date_of_birth: bool,
    gender: bool,
    issuing_state: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliNetwork {
    chain_id: u64,
    rpc_url: String,
    registry_address: String,
    endpoint_type: String,
    app_url: String,
    app_name: String,
    scope: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SmartWalletTemplate {
    agent_address: String,
    r: String,
    s: String,
    v: u64,
    config_index: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistrationData {
    human_identifier: String,
    agent_address: String,
    user_defined_data: Option<String>,
    challenge_hash: Option<String>,
    signature: Option<SignatureParts>,
    smart_wallet_template: Option<SmartWalletTemplate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CallbackData {
    listen_host: String,
    listen_port: u16,
    path: String,
    state_token: String,
    used: bool,
    last_status: Option<String>,
    last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StateData {
    stage: String,
    updated_at: u64,
    last_error: Option<String>,
    agent_id: Option<String>,
    guardian_address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SecretsData {
    agent_private_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CliSession {
    version: u8,
    #[serde(default = "default_operation")]
    operation: String,
    session_id: String,
    created_at: u64,
    expires_at: u64,
    mode: String,
    disclosures: Disclosures,
    network: CliNetwork,
    registration: RegistrationData,
    callback: CallbackData,
    state: StateData,
    secrets: Option<SecretsData>,
}

#[derive(Debug, Default)]
struct CallbackState {
    used: bool,
    error: Option<String>,
    guardian_address: Option<String>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or(Duration::from_secs(0))
        .as_millis() as u64
}

fn random_hex(bytes_len: usize) -> Result<String, String> {
    let mut file = File::open("/dev/urandom").map_err(|e| e.to_string())?;
    let mut bytes = vec![0u8; bytes_len];
    file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
    Ok(hex::encode(bytes))
}

fn random_private_key_hex() -> Result<String, String> {
    loop {
        let mut file = File::open("/dev/urandom").map_err(|e| e.to_string())?;
        let mut bytes = [0u8; 32];
        file.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        let key = format!("0x{}", hex::encode(bytes));
        if key.parse::<PrivateKeySigner>().is_ok() {
            return Ok(key);
        }
    }
}

fn secure_write(path: &Path, text: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    Ok(())
}

fn save_session(path: &Path, session: &mut CliSession) -> Result<(), String> {
    session.state.updated_at = now_ms();
    let text = serde_json::to_string_pretty(session).map_err(|e| e.to_string())?;
    secure_write(path, &(text + "\n"))
}

fn load_session(path: &Path) -> Result<CliSession, String> {
    let raw = read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

fn parse_cli_tokens(argv: &[String]) -> (Vec<String>, HashMap<String, String>) {
    let mut positionals = Vec::new();
    let mut flags = HashMap::new();

    let mut i = 0usize;
    while i < argv.len() {
        let token = &argv[i];
        if token.starts_with("--") {
            let key = token.trim_start_matches("--").to_string();
            if i + 1 < argv.len() && !argv[i + 1].starts_with("--") {
                flags.insert(key, argv[i + 1].clone());
                i += 2;
            } else {
                flags.insert(key, "true".to_string());
                i += 1;
            }
        } else {
            positionals.push(token.clone());
            i += 1;
        }
    }

    (positionals, flags)
}

fn flag_str(flags: &HashMap<String, String>, key: &str, default: &str) -> String {
    flags
        .get(key)
        .cloned()
        .unwrap_or_else(|| default.to_string())
}

fn flag_bool(flags: &HashMap<String, String>, key: &str) -> bool {
    flags.get(key).map(|v| v == "true").unwrap_or(false)
}

fn flag_u64(flags: &HashMap<String, String>, key: &str, default: u64) -> Result<u64, String> {
    match flags.get(key) {
        Some(v) => v
            .parse::<u64>()
            .map_err(|_| format!("Invalid integer for --{key}: {v}")),
        None => Ok(default),
    }
}

fn flag_u16(flags: &HashMap<String, String>, key: &str) -> Result<Option<u16>, String> {
    match flags.get(key) {
        Some(v) => v
            .parse::<u16>()
            .map(Some)
            .map_err(|_| format!("Invalid integer for --{key}: {v}")),
        None => Ok(None),
    }
}

fn parse_mode(mode: &str) -> Result<&'static str, String> {
    match mode {
        "self-custody" => Ok("self-custody"),
        "linked" => Ok("linked"),
        "wallet-free" => Ok("wallet-free"),
        "ed25519" => Ok("ed25519"),
        "ed25519-linked" => Ok("ed25519-linked"),
        "smartwallet" => Ok("smartwallet"),
        _ => Err(format!("Unsupported mode: {mode}")),
    }
}

fn parse_disclosures(flags: &HashMap<String, String>) -> Result<Disclosures, String> {
    let minimum_age = flag_u64(flags, "minimum-age", 0)? as u8;
    if minimum_age != 0 && minimum_age != 18 && minimum_age != 21 {
        return Err("--minimum-age must be 0, 18, or 21".to_string());
    }
    Ok(Disclosures {
        minimum_age,
        ofac: flag_bool(flags, "ofac"),
        nationality: flag_bool(flags, "nationality"),
        name: flag_bool(flags, "name"),
        date_of_birth: flag_bool(flags, "date-of-birth"),
        gender: flag_bool(flags, "gender"),
        issuing_state: flag_bool(flags, "issuing-state"),
    })
}

fn parse_network(flags: &HashMap<String, String>) -> Result<CliNetwork, String> {
    let app_url = flag_str(flags, "app-url", DEFAULT_APP_URL)
        .trim_end_matches('/')
        .to_string();
    let app_name = flag_str(flags, "app-name", DEFAULT_APP_NAME);
    let scope = flag_str(flags, "scope", DEFAULT_SCOPE);

    if let Some(chain_str) = flags.get("chain") {
        let chain_id = chain_str
            .parse::<u64>()
            .map_err(|_| format!("Invalid integer for --chain: {chain_str}"))?;
        let registry = flags
            .get("registry")
            .cloned()
            .ok_or("--registry is required when --chain is provided")?;
        let rpc = flags
            .get("rpc")
            .cloned()
            .ok_or("--rpc is required when --chain is provided")?;
        let reg_addr = Address::from_str(&registry).map_err(|e| e.to_string())?;

        return Ok(CliNetwork {
            chain_id,
            rpc_url: rpc,
            registry_address: format!("{:#x}", reg_addr),
            endpoint_type: if chain_id == 42220 {
                "celo".to_string()
            } else {
                "staging_celo".to_string()
            },
            app_url,
            app_name,
            scope,
        });
    }

    let network_name = flag_str(flags, "network", "testnet").to_lowercase();
    let (net_enum, chain_id, endpoint_type) = match network_name.as_str() {
        "mainnet" => (NetworkName::Mainnet, 42220, "celo"),
        "testnet" => (NetworkName::Testnet, 11142220, "staging_celo"),
        _ => return Err(format!("Unsupported network: {network_name}")),
    };
    let net = network_config(net_enum);
    Ok(CliNetwork {
        chain_id,
        rpc_url: net.rpc_url.to_string(),
        registry_address: format!("{:#x}", net.registry_address),
        endpoint_type: endpoint_type.to_string(),
        app_url,
        app_name,
        scope,
    })
}

/// Convert CLI Disclosures to library RegistrationDisclosures.
fn to_reg_disclosures(d: &Disclosures) -> RegistrationDisclosures {
    RegistrationDisclosures {
        minimum_age: d.minimum_age,
        ofac: d.ofac,
    }
}

fn callback_url(session: &CliSession) -> String {
    format!(
        "http://{}:{}{}",
        session.callback.listen_host, session.callback.listen_port, session.callback.path
    )
}

fn get_session_operation(session: &CliSession) -> &str {
    if session.operation.is_empty() {
        OP_REGISTER
    } else {
        session.operation.as_str()
    }
}

fn handoff_url(session: &CliSession) -> Result<String, String> {
    let payload = json!({
        "version": 1,
        "operation": get_session_operation(session),
        "sessionId": session.session_id,
        "stateToken": session.callback.state_token,
        "callbackUrl": callback_url(session),
        "mode": session.mode,
        "chainId": session.network.chain_id,
        "registryAddress": session.network.registry_address,
        "endpointType": session.network.endpoint_type,
        "appName": session.network.app_name,
        "scope": session.network.scope,
        "humanIdentifier": session.registration.human_identifier,
        "expectedAgentAddress": session.registration.agent_address,
        "disclosures": session.disclosures,
        "userDefinedData": session.registration.user_defined_data,
        "smartWalletTemplate": session.registration.smart_wallet_template,
        "expiresAt": session.expires_at,
    });

    let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(serde_json::to_vec(&payload).map_err(|e| e.to_string())?);
    Ok(format!(
        "{}/cli/register?payload={encoded}",
        session.network.app_url
    ))
}

fn print_json(value: serde_json::Value) {
    println!(
        "{}",
        serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string())
    );
}

fn parse_path_flag(flags: &HashMap<String, String>, key: &str, default: Option<String>) -> PathBuf {
    if let Some(v) = flags.get(key) {
        PathBuf::from(v)
    } else if let Some(v) = default {
        PathBuf::from(v)
    } else {
        PathBuf::from("")
    }
}

async fn command_register_init(flags: &HashMap<String, String>) -> Result<(), String> {
    command_init(flags, OP_REGISTER).await
}

async fn command_deregister_init(flags: &HashMap<String, String>) -> Result<(), String> {
    command_init(flags, OP_DEREGISTER).await
}

async fn command_init(flags: &HashMap<String, String>, operation: &str) -> Result<(), String> {
    let mode = parse_mode(&flag_str(flags, "mode", ""))?.to_string();
    let network = parse_network(flags)?;
    let disclosures = parse_disclosures(flags)?;
    let ttl_minutes = flag_u64(flags, "ttl-minutes", 30)?;
    if ttl_minutes == 0 {
        return Err("--ttl-minutes must be > 0".to_string());
    }

    let out_default = format!(".self/session-{}.json", random_hex(8)?);
    let out_path = parse_path_flag(flags, "out", Some(out_default));

    let created_at = now_ms();
    let expires_at = created_at + ttl_minutes * 60_000;

    let mut human_identifier = String::new();
    let mut agent_address = String::new();
    let mut user_defined_data: Option<String> = None;
    let mut challenge_hash: Option<String> = None;
    let mut signature: Option<SignatureParts> = None;
    let mut smart_wallet_template: Option<SmartWalletTemplate> = None;
    let mut private_key: Option<String> = None;

    if mode == "self-custody" || mode == "linked" {
        let human = flags
            .get("human-address")
            .cloned()
            .ok_or("--human-address is required for self-custody and linked modes")?;
        human_identifier = format!(
            "{:#x}",
            Address::from_str(&human).map_err(|e| e.to_string())?
        );
    }

    let reg_d = to_reg_disclosures(&disclosures);

    if operation == OP_REGISTER {
        if mode == "self-custody" {
            agent_address = human_identifier.clone();
            user_defined_data = Some(build_simple_register_user_data_ascii(&reg_d));
        } else {
            let pk = random_private_key_hex()?;
            let signer: PrivateKeySigner =
                pk.parse::<PrivateKeySigner>().map_err(|e| e.to_string())?;
            private_key = Some(pk.clone());
            agent_address = format!("{:#x}", signer.address());

            if mode == "wallet-free" || mode == "smartwallet" {
                human_identifier = agent_address.clone();
            }

            let reg_addr =
                Address::from_str(&network.registry_address).map_err(|e| e.to_string())?;
            let human_addr = Address::from_str(&human_identifier).map_err(|e| e.to_string())?;
            // Nonce is 0 for freshly generated agent wallets (never registered before)
            let signed = sign_registration_challenge(&pk, human_addr, network.chain_id, reg_addr, 0)
                .await
                .map_err(|e| e.to_string())?;
            challenge_hash = Some(signed.message_hash.clone());
            let sig_parts = signed.parts.clone();
            signature = Some(sig_parts.clone());

            if mode == "linked" {
                user_defined_data = Some(build_advanced_register_user_data_ascii(
                    &agent_address,
                    &sig_parts,
                    &reg_d,
                ));
            } else if mode == "wallet-free" {
                user_defined_data = Some(build_wallet_free_register_user_data_ascii(
                    &agent_address,
                    "0x0000000000000000000000000000000000000000",
                    &sig_parts,
                    &reg_d,
                ));
            } else if mode == "smartwallet" {
                smart_wallet_template = Some(SmartWalletTemplate {
                    agent_address: agent_address.clone(),
                    r: sig_parts.r.clone(),
                    s: sig_parts.s.clone(),
                    v: sig_parts.v,
                    config_index: get_registration_config_index(&reg_d),
                });
            }
        }
    } else {
        if mode == "self-custody" {
            agent_address = human_identifier.clone();
            user_defined_data = Some(build_simple_deregister_user_data_ascii(&reg_d));
        } else if mode == "linked" {
            let agent = flags
                .get("agent-address")
                .cloned()
                .ok_or("--agent-address is required for linked deregistration")?;
            let parsed = Address::from_str(&agent).map_err(|e| e.to_string())?;
            agent_address = format!("{:#x}", parsed);
            user_defined_data = Some(build_advanced_deregister_user_data_ascii(
                &agent_address,
                &reg_d,
            ));
        } else if mode == "wallet-free" || mode == "smartwallet" {
            let agent = flags.get("agent-address").cloned().ok_or(
                "--agent-address is required for wallet-free and smartwallet deregistration",
            )?;
            let parsed = Address::from_str(&agent).map_err(|e| e.to_string())?;
            agent_address = format!("{:#x}", parsed);
            human_identifier = agent_address.clone();
            user_defined_data = Some(build_simple_deregister_user_data_ascii(&reg_d));
        }
    }

    let callback_port =
        flag_u16(flags, "callback-port")?.unwrap_or(37100 + (now_ms() as u16 % 900));

    let mut session = CliSession {
        version: 1,
        operation: operation.to_string(),
        session_id: random_hex(16)?,
        created_at,
        expires_at,
        mode: mode.clone(),
        disclosures,
        network,
        registration: RegistrationData {
            human_identifier,
            agent_address: agent_address.clone(),
            user_defined_data,
            challenge_hash,
            signature,
            smart_wallet_template,
        },
        callback: CallbackData {
            listen_host: "127.0.0.1".to_string(),
            listen_port: callback_port,
            path: "/callback".to_string(),
            state_token: random_hex(24)?,
            used: false,
            last_status: None,
            last_error: None,
        },
        state: StateData {
            stage: "initialized".to_string(),
            updated_at: created_at,
            last_error: None,
            agent_id: None,
            guardian_address: None,
        },
        secrets: private_key.map(|k| SecretsData {
            agent_private_key: Some(k),
        }),
    };

    save_session(&out_path, &mut session)?;

    print_json(json!({
        "ok": true,
        "sessionPath": out_path,
        "sessionId": session.session_id,
        "operation": operation,
        "mode": mode,
        "agentAddress": agent_address,
        "callbackUrl": callback_url(&session),
        "next": [
            format!("self-agent-cli {} open --session {}", operation, out_path.display()),
            format!("self-agent-cli {} wait --session {}", operation, out_path.display())
        ]
    }));

    Ok(())
}

fn command_open(flags: &HashMap<String, String>) -> Result<(), String> {
    let path = parse_path_flag(flags, "session", None);
    if path.as_os_str().is_empty() {
        return Err("Missing required --session".to_string());
    }
    let mut session = load_session(&path)?;
    let operation = get_session_operation(&session).to_string();
    if now_ms() > session.expires_at {
        session.state.stage = "expired".to_string();
        session.state.last_error = Some("Session expired".to_string());
        save_session(&path, &mut session)?;
        return Err(format!("Session expired. Run `{operation} init` again."));
    }
    let url = handoff_url(&session)?;
    session.state.stage = "handoff_opened".to_string();
    save_session(&path, &mut session)?;
    print_json(json!({
        "ok": true,
        "sessionPath": path,
        "operation": operation,
        "url": url,
        "callbackUrl": callback_url(&session),
    }));
    Ok(())
}

async fn poll_onchain(session: &CliSession) -> Result<(bool, String), String> {
    let rpc_url: reqwest::Url = session
        .network
        .rpc_url
        .parse::<reqwest::Url>()
        .map_err(|e| e.to_string())?;
    let provider = ProviderBuilder::new().connect_http(rpc_url);
    let registry_address =
        Address::from_str(&session.network.registry_address).map_err(|e| e.to_string())?;
    let registry = IAgentRegistry::new(registry_address, &provider);
    let agent_address =
        Address::from_str(&session.registration.agent_address).map_err(|e| e.to_string())?;
    let key = address_to_agent_key(agent_address);
    let verified = registry
        .isVerifiedAgent(key)
        .call()
        .await
        .map_err(|e| e.to_string())?;
    let agent_id = registry
        .getAgentId(key)
        .call()
        .await
        .map_err(|e| e.to_string())?;
    Ok((verified, agent_id.to_string()))
}

fn send_http_response(stream: &mut TcpStream, status: u16, payload: serde_json::Value) {
    let body = serde_json::to_string(&payload)
        .unwrap_or_else(|_| "{\"error\":\"serialization\"}".to_string());
    let status_text = match status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        401 => "Unauthorized",
        404 => "Not Found",
        409 => "Conflict",
        _ => "OK",
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        status_text,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
}

fn read_http_request(stream: &mut TcpStream) -> Option<(String, String, String)> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
    let mut data = Vec::new();
    let mut header_end = None;
    let mut content_length = 0usize;

    loop {
        let mut buf = [0u8; 1024];
        let n = match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(_) => return None,
        };
        data.extend_from_slice(&buf[..n]);

        if header_end.is_none() {
            if let Some(pos) = data.windows(4).position(|w| w == b"\r\n\r\n") {
                header_end = Some(pos + 4);
                let header_text = String::from_utf8_lossy(&data[..pos + 4]).to_string();
                for line in header_text.lines() {
                    let lower = line.to_ascii_lowercase();
                    if lower.starts_with("content-length:") {
                        if let Some(v) = line.split(':').nth(1) {
                            content_length = v.trim().parse::<usize>().unwrap_or(0);
                        }
                    }
                }
            }
        }

        if let Some(h) = header_end {
            if data.len() >= h + content_length {
                break;
            }
        }

        if data.len() > 1024 * 1024 {
            return None;
        }
    }

    let h = header_end?;
    let header_text = String::from_utf8_lossy(&data[..h]).to_string();
    let body = String::from_utf8_lossy(&data[h..]).to_string();

    let mut lines = header_text.lines();
    let first = lines.next()?;
    let parts: Vec<&str> = first.split_whitespace().collect();
    if parts.len() < 2 {
        return None;
    }
    let method = parts[0].to_string();
    let path = parts[1].to_string();
    Some((method, path, body))
}

fn start_callback_listener(
    session: &CliSession,
    state: Arc<Mutex<CallbackState>>,
    running: Arc<AtomicBool>,
) -> Result<std::thread::JoinHandle<()>, String> {
    let addr = format!(
        "{}:{}",
        session.callback.listen_host, session.callback.listen_port
    );
    let listener = TcpListener::bind(&addr).map_err(|e| e.to_string())?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let expected_path = session.callback.path.clone();
    let expected_session_id = session.session_id.clone();
    let expected_token = session.callback.state_token.clone();

    let handle = std::thread::spawn(move || {
        while running.load(Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut stream, _)) => match read_http_request(&mut stream) {
                    Some((method, path, body)) => {
                        if method == "OPTIONS" {
                            send_http_response(&mut stream, 204, json!({"ok": true}));
                            continue;
                        }
                        let clean_path = path.split('?').next().unwrap_or("").to_string();
                        if method != "POST" || clean_path != expected_path {
                            send_http_response(&mut stream, 404, json!({"error": "Not found"}));
                            continue;
                        }

                        let parsed: serde_json::Value = match serde_json::from_str(&body) {
                            Ok(v) => v,
                            Err(err) => {
                                send_http_response(
                                    &mut stream,
                                    400,
                                    json!({"error": err.to_string()}),
                                );
                                continue;
                            }
                        };

                        if parsed.get("sessionId").and_then(|v| v.as_str())
                            != Some(&expected_session_id)
                        {
                            send_http_response(
                                &mut stream,
                                400,
                                json!({"error": "Session mismatch"}),
                            );
                            continue;
                        }
                        if parsed.get("stateToken").and_then(|v| v.as_str())
                            != Some(&expected_token)
                        {
                            send_http_response(
                                &mut stream,
                                401,
                                json!({"error": "Invalid state token"}),
                            );
                            continue;
                        }

                        let mut guard = state.lock().expect("callback state poisoned");
                        if guard.used {
                            send_http_response(
                                &mut stream,
                                409,
                                json!({"error": "Callback already used"}),
                            );
                            continue;
                        }

                        guard.used = true;
                        if parsed.get("status").and_then(|v| v.as_str()) == Some("error") {
                            guard.error = Some(
                                parsed
                                    .get("error")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("Browser callback error")
                                    .to_string(),
                            );
                        }
                        if let Some(guardian) =
                            parsed.get("guardianAddress").and_then(|v| v.as_str())
                        {
                            guard.guardian_address = Some(guardian.to_string());
                        }
                        send_http_response(&mut stream, 200, json!({"ok": true}));
                    }
                    None => {
                        send_http_response(
                            &mut stream,
                            400,
                            json!({"error": "Invalid HTTP request"}),
                        );
                    }
                },
                Err(err) => {
                    if err.kind() == std::io::ErrorKind::WouldBlock {
                        std::thread::sleep(Duration::from_millis(100));
                        continue;
                    }
                    break;
                }
            }
        }
    });

    Ok(handle)
}

async fn command_register_wait(flags: &HashMap<String, String>) -> Result<(), String> {
    command_wait(flags).await
}

async fn command_deregister_wait(flags: &HashMap<String, String>) -> Result<(), String> {
    command_wait(flags).await
}

async fn command_wait(flags: &HashMap<String, String>) -> Result<(), String> {
    let path = parse_path_flag(flags, "session", None);
    if path.as_os_str().is_empty() {
        return Err("Missing required --session".to_string());
    }
    let mut session = load_session(&path)?;
    let operation = get_session_operation(&session).to_string();

    let timeout_seconds = flag_u64(flags, "timeout-seconds", 1800)?;
    let poll_ms = flag_u64(flags, "poll-ms", 4000)?;
    if timeout_seconds == 0 {
        return Err("--timeout-seconds must be > 0".to_string());
    }
    if poll_ms == 0 {
        return Err("--poll-ms must be > 0".to_string());
    }

    if now_ms() > session.expires_at {
        session.state.stage = "expired".to_string();
        session.state.last_error = Some("Session expired".to_string());
        save_session(&path, &mut session)?;
        return Err(format!("Session expired. Run `{operation} init` again."));
    }

    if flag_bool(flags, "open") {
        println!("{}", handoff_url(&session)?);
        session.state.stage = "handoff_opened".to_string();
        save_session(&path, &mut session)?;
    }

    let callback_state = Arc::new(Mutex::new(CallbackState::default()));
    let running = Arc::new(AtomicBool::new(true));
    let mut listener_enabled = !flag_bool(flags, "no-listener");
    let mut listener_thread = if listener_enabled {
        match start_callback_listener(&session, callback_state.clone(), running.clone()) {
            Ok(handle) => Some(handle),
            Err(err) => {
                listener_enabled = false;
                eprintln!(
                    "Callback listener unavailable ({err}). Continuing with on-chain polling only."
                );
                None
            }
        }
    } else {
        None
    };

    let deadline = now_ms() + timeout_seconds * 1000;
    let mut verified = false;
    let mut agent_id = "0".to_string();
    let mut last_poll_error = String::new();

    while now_ms() < deadline {
        {
            let guard = callback_state
                .lock()
                .map_err(|_| "callback state lock failed")?;
            if guard.used && !session.callback.used {
                session.callback.used = true;
                session.callback.last_status = Some(if guard.error.is_some() {
                    "error".to_string()
                } else {
                    "success".to_string()
                });

                if let Some(err) = &guard.error {
                    session.callback.last_error = Some(err.clone());
                    session.state.stage = "failed".to_string();
                    session.state.last_error = Some(err.clone());
                    save_session(&path, &mut session)?;
                    running.store(false, Ordering::Relaxed);
                    if let Some(thread) = listener_thread.take() {
                        let _ = thread.join();
                    }
                    return Err(format!(
                        "{} failed via callback: {err}",
                        if operation == OP_REGISTER {
                            "Registration"
                        } else {
                            "Deregistration"
                        }
                    ));
                }

                if let Some(guardian) = &guard.guardian_address {
                    if let Ok(addr) = Address::from_str(guardian) {
                        session.state.guardian_address = Some(format!("{:#x}", addr));
                    }
                }
                session.state.stage = "callback_received".to_string();
                save_session(&path, &mut session)?;
            }
        }

        match poll_onchain(&session).await {
            Ok((is_verified, id)) => {
                verified = is_verified;
                agent_id = id;
                let completed = if operation == OP_REGISTER {
                    verified && agent_id != "0"
                } else {
                    !verified && agent_id == "0"
                };
                if completed {
                    session.state.stage = if operation == OP_REGISTER {
                        "onchain_verified".to_string()
                    } else {
                        "onchain_deregistered".to_string()
                    };
                    session.state.agent_id = if operation == OP_REGISTER {
                        Some(agent_id.clone())
                    } else {
                        None
                    };
                    session.state.last_error = None;
                    save_session(&path, &mut session)?;
                    break;
                }
            }
            Err(err) => {
                last_poll_error = err;
            }
        }

        tokio::time::sleep(Duration::from_millis(poll_ms)).await;
    }

    running.store(false, Ordering::Relaxed);
    if let Some(thread) = listener_thread.take() {
        let _ = thread.join();
    }

    let completed = if operation == OP_REGISTER {
        verified && agent_id != "0"
    } else {
        !verified && agent_id == "0"
    };
    if !completed {
        session.state.stage = "expired".to_string();
        session.state.last_error = Some(if last_poll_error.is_empty() {
            format!("Timed out waiting for on-chain {operation}")
        } else {
            format!("Timed out waiting for on-chain {operation}: {last_poll_error}")
        });
        save_session(&path, &mut session)?;
        return Err(session
            .state
            .last_error
            .clone()
            .unwrap_or_else(|| format!("Timed out waiting for on-chain {operation}")));
    }

    print_json(json!({
        "ok": true,
        "sessionPath": path,
        "operation": operation,
        "stage": session.state.stage,
        "agentAddress": session.registration.agent_address,
        "agentId": if operation == OP_REGISTER {
            serde_json::Value::String(agent_id)
        } else {
            serde_json::Value::Null
        },
        "callbackReceived": session.callback.used,
        "callbackListener": listener_enabled,
        "guardianAddress": session.state.guardian_address,
    }));

    Ok(())
}

fn command_register_status(flags: &HashMap<String, String>) -> Result<(), String> {
    command_status(flags)
}

fn command_deregister_status(flags: &HashMap<String, String>) -> Result<(), String> {
    command_status(flags)
}

fn command_status(flags: &HashMap<String, String>) -> Result<(), String> {
    let path = parse_path_flag(flags, "session", None);
    if path.as_os_str().is_empty() {
        return Err("Missing required --session".to_string());
    }
    let session = load_session(&path)?;
    print_json(json!({
        "ok": true,
        "sessionPath": path,
        "sessionId": session.session_id,
        "operation": get_session_operation(&session),
        "mode": session.mode,
        "stage": session.state.stage,
        "expiresAt": session.expires_at,
        "agentAddress": session.registration.agent_address,
        "agentId": session.state.agent_id,
        "callbackUrl": callback_url(&session),
        "callbackUsed": session.callback.used,
        "lastError": session.state.last_error,
    }));
    Ok(())
}

fn command_register_export(flags: &HashMap<String, String>) -> Result<(), String> {
    let path = parse_path_flag(flags, "session", None);
    if path.as_os_str().is_empty() {
        return Err("Missing required --session".to_string());
    }

    let session = load_session(&path)?;
    let key = session
        .secrets
        .as_ref()
        .and_then(|s| s.agent_private_key.clone())
        .ok_or("No agent private key in this session")?;

    if !flag_bool(flags, "unsafe") {
        return Err("Export blocked. Re-run with --unsafe".to_string());
    }

    let print_key = flag_bool(flags, "print-private-key");
    let out_key = flags.get("out-key").map(PathBuf::from);

    if !print_key && out_key.is_none() {
        return Err("Nothing to export. Provide --out-key or --print-private-key".to_string());
    }

    if let Some(path) = out_key {
        secure_write(&path, &(key.clone() + "\n"))?;
    }

    if print_key {
        println!("{key}");
    }

    print_json(json!({
        "ok": true,
        "sessionPath": path,
        "printed": print_key,
    }));
    Ok(())
}

fn usage() -> String {
    [
        "Self Agent CLI",
        "",
        "Commands:",
        "  register init    Create registration session",
        "  register open    Print browser handoff URL",
        "  register wait    Wait for callback + on-chain verification",
        "  register status  Show session status",
        "  register export  Export generated private key (--unsafe required)",
        "  deregister init  Create deregistration session",
        "  deregister open  Print browser handoff URL",
        "  deregister wait  Wait for callback + on-chain deregistration",
        "  deregister status Show session status",
        "",
        "Examples:",
        "  self-agent-cli register init --mode self-custody --human-address 0x... --network testnet --out .self/session.json",
        "  self-agent-cli register open --session .self/session.json",
        "  self-agent-cli register wait --session .self/session.json --timeout-seconds 1800",
        "  self-agent-cli deregister init --mode self-custody --human-address 0x... --network testnet --out .self/session.json",
        "  self-agent-cli deregister open --session .self/session.json",
        "  self-agent-cli deregister wait --session .self/session.json --timeout-seconds 1800",
    ]
    .join("\n")
}

#[tokio::main]
async fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let (positionals, flags) = parse_cli_tokens(&argv);

    if positionals.len() < 2 || (positionals[0] != OP_REGISTER && positionals[0] != OP_DEREGISTER) {
        eprintln!("{}", usage());
        std::process::exit(1);
    }

    let family = positionals[0].as_str();
    let command = &positionals[1];
    let result = match command.as_str() {
        "init" => {
            if family == OP_REGISTER {
                command_register_init(&flags).await
            } else {
                command_deregister_init(&flags).await
            }
        }
        "open" => command_open(&flags),
        "wait" => {
            if family == OP_REGISTER {
                command_register_wait(&flags).await
            } else {
                command_deregister_wait(&flags).await
            }
        }
        "status" => {
            if family == OP_REGISTER {
                command_register_status(&flags)
            } else {
                command_deregister_status(&flags)
            }
        }
        "export" => {
            if family != OP_REGISTER {
                Err("`deregister export` is not supported.".to_string())
            } else {
                command_register_export(&flags)
            }
        }
        _ => Err(format!("Unknown subcommand: {command}")),
    };

    if let Err(err) = result {
        eprintln!("{err}");
        std::process::exit(1);
    }
}
