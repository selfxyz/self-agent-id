"""Agent-side SDK — sign requests and check on-chain status."""
import json
import base64
import time

import httpx
from web3 import Web3
from eth_account import Account

from .constants import NETWORKS, DEFAULT_NETWORK, REGISTRY_ABI, PROVIDER_ABI, HEADERS, ZERO_ADDRESS, NetworkName
from .types import AgentInfo, AgentCredentials
from .agent_card import (
    A2AAgentCard, AgentSkill, SelfProtocolExtension, TrustModel, CardCredentials,
    get_provider_label, build_agent_card_dict,
)
from ._signing import compute_body_hash, compute_message, sign_message, address_to_agent_key


class SelfAgent:
    """
    Agent-side SDK for Self Agent ID.

    Usage:
        agent = SelfAgent(private_key="0x...")                    # mainnet
        agent = SelfAgent(private_key="0x...", network="testnet") # testnet

        headers = agent.sign_request("POST", "https://api.example.com/data", body='{"q":"test"}')
        response = agent.fetch("https://api.example.com/data", method="POST", body='{"q":"test"}')
    """

    def __init__(
        self,
        private_key: str,
        network: NetworkName | None = None,
        registry_address: str | None = None,
        rpc_url: str | None = None,
    ):
        net = NETWORKS[network or DEFAULT_NETWORK]
        self._rpc_url = rpc_url or net["rpc_url"]
        self._registry_address = registry_address or net["registry_address"]

        self._account = Account.from_key(private_key)
        self._private_key = private_key
        self._w3 = Web3(Web3.HTTPProvider(self._rpc_url))
        self._registry = self._w3.eth.contract(
            address=Web3.to_checksum_address(self._registry_address),
            abi=REGISTRY_ABI,
        )
        self._agent_key = address_to_agent_key(self._account.address)

    @property
    def address(self) -> str:
        return self._account.address

    @property
    def agent_key(self) -> bytes:
        return self._agent_key

    def sign_request(self, method: str, url: str, body: str | None = None) -> dict[str, str]:
        """Generate authentication headers for a request."""
        timestamp = str(int(time.time() * 1000))
        body_hash = compute_body_hash(body)
        message = compute_message(timestamp, method, url, body_hash)
        signature = sign_message(message, self._private_key)
        return {
            HEADERS["ADDRESS"]: self._account.address,
            HEADERS["SIGNATURE"]: signature,
            HEADERS["TIMESTAMP"]: timestamp,
        }

    def is_registered(self) -> bool:
        """Check if this agent is registered and verified on-chain."""
        return self._registry.functions.isVerifiedAgent(self._agent_key).call()

    def get_info(self) -> AgentInfo:
        """Get full agent info from the registry."""
        agent_id = self._registry.functions.getAgentId(self._agent_key).call()
        if agent_id == 0:
            return AgentInfo(
                address=self._account.address,
                agent_key=self._agent_key,
                agent_id=0, is_verified=False, nullifier=0, agent_count=0,
            )
        is_verified = self._registry.functions.hasHumanProof(agent_id).call()
        nullifier = self._registry.functions.getHumanNullifier(agent_id).call()
        agent_count = self._registry.functions.getAgentCountForHuman(nullifier).call()
        return AgentInfo(
            address=self._account.address,
            agent_key=self._agent_key,
            agent_id=agent_id,
            is_verified=is_verified,
            nullifier=nullifier,
            agent_count=agent_count,
        )

    def fetch(
        self, url: str, method: str = "GET",
        body: str | None = None, headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Make an auto-signed HTTP request."""
        auth_headers = self.sign_request(method, url, body)
        all_headers = {**(headers or {}), **auth_headers}
        return httpx.request(method, url, headers=all_headers, content=body)

    # ─── A2A Agent Card Methods ───────────────────────────────────────────

    def get_agent_card(self) -> A2AAgentCard | None:
        """Read the A2A Agent Card from on-chain metadata (if set).

        Returns None if the agent is not registered or has no card.
        """
        agent_id = self._registry.functions.getAgentId(self._agent_key).call()
        if agent_id == 0:
            return None
        raw = self._registry.functions.getAgentMetadata(agent_id).call()
        if not raw:
            return None
        try:
            parsed = json.loads(raw)
            if parsed.get("a2aVersion"):
                return self._dict_to_card(parsed)
        except (json.JSONDecodeError, KeyError):
            pass
        return None

    def set_agent_card(
        self,
        name: str,
        description: str | None = None,
        url: str | None = None,
        skills: list[AgentSkill] | None = None,
    ) -> str:
        """Build and write an A2A Agent Card to on-chain metadata.

        Auto-populates selfProtocol fields (trust model, credentials) from on-chain data.
        Returns the transaction hash as a hex string.
        """
        agent_id = self._registry.functions.getAgentId(self._agent_key).call()
        if agent_id == 0:
            raise ValueError("Agent not registered")

        provider_addr = self._registry.functions.getProofProvider(agent_id).call()
        if not provider_addr or provider_addr == ZERO_ADDRESS:
            raise ValueError("Agent has no proof provider — cannot build card")
        provider_contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(provider_addr), abi=PROVIDER_ABI,
        )

        provider_name = provider_contract.functions.providerName().call()
        strength = provider_contract.functions.verificationStrength().call()
        proof_type = get_provider_label(strength)

        trust_model = TrustModel(
            proof_type=proof_type, sybil_resistant=True,
            ofac_screened=False, minimum_age_verified=0,
        )
        card_creds = None

        try:
            creds = self._registry.functions.getAgentCredentials(agent_id).call()
            older_than = int(creds[7]) if creds[7] else 0
            ofac = creds[8] if len(creds) > 8 else [False, False, False]
            ofac_screened = ofac[0] if ofac else False

            trust_model.ofac_screened = ofac_screened
            trust_model.minimum_age_verified = older_than

            card_creds = CardCredentials(
                nationality=creds[3] or None,
                issuing_state=creds[0] or None,
                older_than=older_than or None,
                ofac_clean=True if ofac_screened else None,
                has_name=True if creds[1] else None,
                has_date_of_birth=True if creds[4] else None,
                has_gender=True if creds[5] else None,
                document_expiry=creds[6] or None,
            )
        except Exception:
            pass

        chain_id = self._w3.eth.chain_id

        card = A2AAgentCard(
            a2a_version="0.1",
            name=name,
            description=description,
            url=url,
            skills=skills,
            self_protocol=SelfProtocolExtension(
                agent_id=agent_id,
                registry=self._registry_address,
                chain_id=chain_id,
                proof_provider=provider_addr,
                provider_name=provider_name,
                verification_strength=strength,
                trust_model=trust_model,
                credentials=card_creds,
            ),
        )

        card_json = json.dumps(build_agent_card_dict(card))
        tx = self._registry.functions.updateAgentMetadata(
            agent_id, card_json,
        ).build_transaction({
            "from": self._account.address,
            "nonce": self._w3.eth.get_transaction_count(self._account.address),
        })
        signed = self._account.sign_transaction(tx)
        tx_hash = self._w3.eth.send_raw_transaction(signed.raw_transaction)
        self._w3.eth.wait_for_transaction_receipt(tx_hash)
        return tx_hash.hex()

    def to_agent_card_data_uri(self) -> str:
        """Return a data: URI with base64-encoded Agent Card JSON.

        Raises ValueError if no agent card is set.
        """
        card = self.get_agent_card()
        if card is None:
            raise ValueError("No A2A Agent Card set")
        card_json = json.dumps(build_agent_card_dict(card))
        encoded = base64.b64encode(card_json.encode()).decode()
        return f"data:application/json;base64,{encoded}"

    def get_credentials(self) -> AgentCredentials | None:
        """Read ZK-attested credentials from on-chain.

        Returns None if the agent is not registered or has no credentials.
        """
        agent_id = self._registry.functions.getAgentId(self._agent_key).call()
        if agent_id == 0:
            return None
        try:
            creds = self._registry.functions.getAgentCredentials(agent_id).call()
            return AgentCredentials(
                issuing_state=creds[0],
                name=list(creds[1]),
                id_number=creds[2],
                nationality=creds[3],
                date_of_birth=creds[4],
                gender=creds[5],
                expiry_date=creds[6],
                older_than=int(creds[7]),
                ofac=list(creds[8]) if len(creds) > 8 else [False, False, False],
            )
        except Exception:
            return None

    def get_verification_strength(self) -> int:
        """Read the verification strength score (0-100) from the provider contract.

        Returns 0 if the agent is not registered or has no provider.
        """
        agent_id = self._registry.functions.getAgentId(self._agent_key).call()
        if agent_id == 0:
            return 0
        provider_addr = self._registry.functions.getProofProvider(agent_id).call()
        if provider_addr == ZERO_ADDRESS:
            return 0
        provider_contract = self._w3.eth.contract(
            address=Web3.to_checksum_address(provider_addr), abi=PROVIDER_ABI,
        )
        return provider_contract.functions.verificationStrength().call()

    @staticmethod
    def _dict_to_card(d: dict) -> A2AAgentCard:
        """Parse a JSON dict into an A2AAgentCard."""
        sp = d["selfProtocol"]
        tm = sp["trustModel"]
        creds = sp.get("credentials")
        return A2AAgentCard(
            a2a_version=d["a2aVersion"],
            name=d["name"],
            description=d.get("description"),
            url=d.get("url"),
            capabilities=d.get("capabilities"),
            skills=[AgentSkill(name=s["name"], description=s.get("description"))
                    for s in d["skills"]] if d.get("skills") else None,
            self_protocol=SelfProtocolExtension(
                agent_id=sp["agentId"],
                registry=sp["registry"],
                chain_id=sp["chainId"],
                proof_provider=sp["proofProvider"],
                provider_name=sp["providerName"],
                verification_strength=sp["verificationStrength"],
                trust_model=TrustModel(
                    proof_type=tm["proofType"],
                    sybil_resistant=tm["sybilResistant"],
                    ofac_screened=tm["ofacScreened"],
                    minimum_age_verified=tm["minimumAgeVerified"],
                ),
                credentials=CardCredentials(
                    nationality=creds.get("nationality"),
                    issuing_state=creds.get("issuingState"),
                    older_than=creds.get("olderThan"),
                    ofac_clean=creds.get("ofacClean"),
                    has_name=creds.get("hasName"),
                    has_date_of_birth=creds.get("hasDateOfBirth"),
                    has_gender=creds.get("hasGender"),
                    document_expiry=creds.get("documentExpiry"),
                ) if creds else None,
            ),
        )
