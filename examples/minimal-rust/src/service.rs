// SPDX-License-Identifier: MIT

//! Minimal service: verify agent requests with Axum.

use axum::{Router, routing::post, middleware, Json, Extension};
use self_agent_sdk::{SelfAgentVerifier, VerifiedAgent, NetworkName, self_agent_auth};
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let verifier = Arc::new(Mutex::new(
        SelfAgentVerifier::create()
            .network(NetworkName::Testnet)
            .require_age(18)
            .require_ofac()
            .build(),
    ));

    let app = Router::new()
        .route("/api/data", post(handle))
        .layer(middleware::from_fn_with_state(verifier, self_agent_auth));

    println!("Service running on :3000");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle(Extension(agent): Extension<VerifiedAgent>) -> Json<serde_json::Value> {
    println!("Verified agent: {:?}", agent.address);
    Json(serde_json::json!({ "ok": true, "agent": agent.address }))
}
