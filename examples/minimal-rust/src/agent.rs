//! Minimal agent: sign and send a verified request.

use self_agent_sdk::{SelfAgent, SelfAgentConfig, NetworkName};

#[tokio::main]
async fn main() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: std::env::var("AGENT_PRIVATE_KEY").expect("AGENT_PRIVATE_KEY required"),
        network: Some(NetworkName::Testnet),
        registry_address: None,
        rpc_url: None,
    })
    .expect("Failed to create agent");

    let registered = agent.is_registered().await.unwrap();
    println!("Registered: {registered}");

    if registered {
        let info = agent.get_info().await.unwrap();
        println!("Agent ID: {}, Verified: {}", info.agent_id, info.is_verified);

        let res = agent
            .fetch(
                "http://localhost:3000/api/data",
                Some(reqwest::Method::POST),
                Some(r#"{"message":"Hello from a verified agent"}"#.to_string()),
            )
            .await
            .unwrap();
        println!("Response: {}", res.status());
    }
}
