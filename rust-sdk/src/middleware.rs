// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/// Axum middleware for Self Agent ID verification.
///
/// Feature-gated behind the `axum` feature flag.
///
/// Usage:
/// ```no_run
/// use axum::{Router, routing::get, middleware};
/// use self_agent_sdk::middleware::self_agent_auth;
/// use self_agent_sdk::{SelfAgentVerifier, VerifierConfig};
/// use std::sync::Arc;
/// use tokio::sync::Mutex;
///
/// async fn handler() -> &'static str { "ok" }
///
/// let verifier = Arc::new(Mutex::new(SelfAgentVerifier::new(VerifierConfig::default())));
/// let app: Router<Arc<Mutex<SelfAgentVerifier>>> = Router::new()
///     .route("/api/protected", get(handler))
///     .layer(middleware::from_fn_with_state(verifier, self_agent_auth));
/// ```
use axum::extract::State;
use axum::http::{Request, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Json, Response};
use std::sync::Arc;
use tokio::sync::Mutex;

use crate::constants::headers;
use crate::verifier::SelfAgentVerifier;

/// Verified agent info attached to request extensions.
#[derive(Debug, Clone)]
pub struct VerifiedAgent {
    pub address: alloy::primitives::Address,
    pub agent_key: alloy::primitives::B256,
    pub agent_id: alloy::primitives::U256,
}

/// Axum middleware that verifies Self Agent ID requests.
///
/// On success, inserts [`VerifiedAgent`] into request extensions.
/// On failure, returns 401 with JSON error.
pub async fn self_agent_auth(
    State(verifier): State<Arc<Mutex<SelfAgentVerifier>>>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    let sig = request
        .headers()
        .get(headers::SIGNATURE)
        .and_then(|v| v.to_str().ok())
        .map(String::from);
    let ts = request
        .headers()
        .get(headers::TIMESTAMP)
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    let (signature, timestamp) = match (sig, ts) {
        (Some(s), Some(t)) => (s, t),
        _ => {
            return (
                StatusCode::UNAUTHORIZED,
                Json(serde_json::json!({ "error": "Missing agent authentication headers" })),
            )
                .into_response();
        }
    };

    let method = request.method().as_str().to_string();
    let url = request.uri().path_and_query().map(|pq| pq.as_str().to_string()).unwrap_or_default();

    // Read body for verification
    let (parts, body) = request.into_parts();
    // Limit body size to 1 MB to prevent OOM from oversized requests
    const MAX_BODY_SIZE: usize = 1024 * 1024;
    let body_bytes = match axum::body::to_bytes(body, MAX_BODY_SIZE).await {
        Ok(b) => b,
        Err(_) => {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({ "error": "Request body too large" })),
            )
                .into_response();
        }
    };
    let body_str = if body_bytes.is_empty() {
        None
    } else {
        Some(String::from_utf8_lossy(&body_bytes).to_string())
    };

    let result = {
        let mut v = verifier.lock().await;
        v.verify(&signature, &timestamp, &method, &url, body_str.as_deref())
            .await
    };

    if !result.valid {
        return (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": result.error.unwrap_or_default() })),
        )
            .into_response();
    }

    let agent = VerifiedAgent {
        address: result.agent_address,
        agent_key: result.agent_key,
        agent_id: result.agent_id,
    };

    // Reconstruct request with body
    let mut request = Request::from_parts(parts, axum::body::Body::from(body_bytes));
    request.extensions_mut().insert(agent);

    next.run(request).await
}
