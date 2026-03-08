# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

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
    ERC8004AgentDocument, AgentSkill, SelfProtocolExtension, TrustModel, CardCredentials,
    ERC8004Service, AgentInterface,
    get_provider_label, build_agent_card_dict,
)
from ._signing import compute_body_hash, compute_message, sign_message, address_to_agent_key
from .registration_flow import (
    DEFAULT_API_BASE, RegistrationSession, DeregistrationSession,
)

def _api_json_or_raise(resp: httpx.Response, fallback_message: str) -> dict:
    """Parse API JSON and raise RuntimeError on HTTP or API-level errors."""
    try:
        data = resp.json()
    except Exception as exc:
        raise RuntimeError(f"{fallback_message}: invalid JSON response") from exc

    if not isinstance(data, dict):
        raise RuntimeError(f"{fallback_message}: unexpected response shape")

    if not resp.is_success:
        message = data.get("error") if isinstance(data.get("error"), str) else f"HTTP {resp.status_code}"
        raise RuntimeError(message)

    if isinstance(data.get("error"), str):
        raise RuntimeError(data["error"])

    return data


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
        self._network_name: NetworkName = network or DEFAULT_NETWORK
        net = NETWORKS[self._network_name]
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

    def get_agent_card(self) -> ERC8004AgentDocument | None:
        """Read the agent card from on-chain metadata (if set).

        Supports both the new ERC-8004 format and legacy A2A v0.1 cards.
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

        # Build services and supportedInterfaces if a URL is provided
        services: list[ERC8004Service] = []
        supported_interfaces: list[AgentInterface] | None = None
        if url:
            services.append(ERC8004Service(name="A2A", endpoint=url, version="0.3.0"))
            supported_interfaces = [
                AgentInterface(url=url, protocol_binding="JSONRPC", protocol_version="0.3.0")
            ]

        card = ERC8004AgentDocument(
            name=name,
            description=description or "",
            image="",
            services=services,
            url=url,
            supported_interfaces=supported_interfaces,
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

    # ─── Registration / Deregistration (REST API) ──────────────────────

    @classmethod
    def request_registration(
        cls,
        *,
        mode: str = "linked",
        network: NetworkName = "mainnet",
        disclosures: dict | None = None,
        human_address: str | None = None,
        agent_name: str | None = None,
        agent_description: str | None = None,
        api_base: str = DEFAULT_API_BASE,
    ) -> RegistrationSession:
        """Initiate agent registration via the REST API.

        Returns a :class:`RegistrationSession` with a QR code URL and deep link
        that the human operator must scan with the Self app.

        Args:
            mode: Registration mode (``"self-custody"``, ``"linked"``,
                ``"wallet-free"``, ``"ed25519"``, ``"ed25519-linked"``, ``"smartwallet"``).
            network: ``"mainnet"`` or ``"testnet"``.
            disclosures: Optional disclosure requirements (e.g.
                ``{"minimumAge": 18, "ofac": True}``).
            human_address: Human's wallet address (required for some modes).
            agent_name: Display name stored on-chain.
            agent_description: Description stored on-chain.
            api_base: Base URL for the Self Agent ID API.
        """
        payload: dict = {
            "mode": mode,
            "network": network,
            "disclosures": disclosures or {},
        }
        if human_address is not None:
            payload["humanAddress"] = human_address
        if agent_name is not None:
            payload["agentName"] = agent_name
        if agent_description is not None:
            payload["agentDescription"] = agent_description

        resp = httpx.post(f"{api_base}/api/agent/register", json=payload)
        data = _api_json_or_raise(resp, "Registration request failed")

        return RegistrationSession(
            session_token=data["sessionToken"],
            stage=data["stage"],
            qr_url=data.get("qrUrl", ""),
            deep_link=data.get("deepLink", ""),
            agent_address=data.get("agentAddress", ""),
            expires_at=data.get("expiresAt", ""),
            time_remaining_ms=data.get("timeRemainingMs", 0),
            human_instructions=data.get("humanInstructions", []),
            _api_base=api_base,
        )

    @classmethod
    def get_agent_info(
        cls,
        agent_id: int,
        *,
        network: NetworkName = "mainnet",
        api_base: str = DEFAULT_API_BASE,
    ) -> dict:
        """Query agent info via the REST API (no private key needed).

        Args:
            agent_id: On-chain agent ID.
            network: ``"mainnet"`` or ``"testnet"``.
            api_base: Base URL for the Self Agent ID API.

        Returns:
            Dict with agent info, credentials, and card data.
        """
        chain_id = 42220 if network == "mainnet" else 11142220
        resp = httpx.get(f"{api_base}/api/agent/info/{chain_id}/{agent_id}")
        return _api_json_or_raise(resp, "Agent info request failed")

    @classmethod
    def get_agents_for_human(
        cls,
        address: str,
        *,
        network: NetworkName = "mainnet",
        api_base: str = DEFAULT_API_BASE,
    ) -> dict:
        """Query all agents registered to a human address via the REST API.

        Args:
            address: Human's Ethereum address.
            network: ``"mainnet"`` or ``"testnet"``.
            api_base: Base URL for the Self Agent ID API.

        Returns:
            Dict with the list of agent IDs for the given human.
        """
        chain_id = 42220 if network == "mainnet" else 11142220
        resp = httpx.get(f"{api_base}/api/agent/agents/{chain_id}/{address}")
        return _api_json_or_raise(resp, "Agents-for-human request failed")

    def request_deregistration(
        self,
        *,
        api_base: str = DEFAULT_API_BASE,
    ) -> DeregistrationSession:
        """Initiate deregistration for this agent via the REST API.

        Returns a :class:`DeregistrationSession` with a QR code URL that the
        human operator must scan with the Self app to confirm removal.
        """
        resp = httpx.post(f"{api_base}/api/agent/deregister", json={
            "network": self._network_name,
            "agentAddress": self._account.address,
        })
        data = _api_json_or_raise(resp, "Deregistration request failed")

        return DeregistrationSession(
            session_token=data["sessionToken"],
            stage=data["stage"],
            qr_url=data.get("qrUrl", ""),
            deep_link=data.get("deepLink", ""),
            expires_at=data.get("expiresAt", ""),
            time_remaining_ms=data.get("timeRemainingMs", 0),
            human_instructions=data.get("humanInstructions", []),
            _api_base=api_base,
        )

    @staticmethod
    def _dict_to_card(d: dict) -> ERC8004AgentDocument:
        """Parse a JSON dict into an ERC8004AgentDocument.

        Supports both the new ERC-8004 format (with 'type' field) and
        legacy A2A v0.1 format (with 'a2aVersion' field).
        """
        # Parse selfProtocol if present
        self_protocol = None
        sp = d.get("selfProtocol")
        if sp:
            tm = sp["trustModel"]
            creds = sp.get("credentials")
            self_protocol = SelfProtocolExtension(
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
            )

        # Parse skills
        skills = None
        if d.get("skills"):
            skills = [
                AgentSkill(
                    id=s.get("id", s["name"]),
                    name=s["name"],
                    description=s.get("description"),
                    tags=s.get("tags"),
                    examples=s.get("examples"),
                    input_modes=s.get("inputModes"),
                    output_modes=s.get("outputModes"),
                )
                for s in d["skills"]
            ]

        # Parse services
        services = [
            ERC8004Service(
                name=s["name"],
                endpoint=s["endpoint"],
                version=s.get("version"),
            )
            for s in d.get("services", [])
        ]

        # Parse supportedInterfaces
        supported_interfaces = None
        if d.get("supportedInterfaces"):
            supported_interfaces = [
                AgentInterface(
                    url=i["url"],
                    protocol_binding=i["protocolBinding"],
                    protocol_version=i["protocolVersion"],
                )
                for i in d["supportedInterfaces"]
            ]

        return ERC8004AgentDocument(
            type=d.get("type", "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"),
            name=d.get("name", ""),
            description=d.get("description", ""),
            image=d.get("image", ""),
            services=services,
            version=d.get("version"),
            url=d.get("url"),
            supported_interfaces=supported_interfaces,
            skills=skills,
            self_protocol=self_protocol,
        )
