from dataclasses import dataclass, field


@dataclass
class AgentInfo:
    address: str
    agent_key: bytes            # 32 bytes
    agent_id: int
    is_verified: bool
    nullifier: int
    agent_count: int


@dataclass
class AgentCredentials:
    issuing_state: str = ""
    name: list[str] = field(default_factory=list)
    id_number: str = ""
    nationality: str = ""
    date_of_birth: str = ""
    gender: str = ""
    expiry_date: str = ""
    older_than: int = 0
    ofac: list[bool] = field(default_factory=lambda: [False, False, False])


@dataclass
class VerificationResult:
    valid: bool
    agent_address: str          # Recovered from signature
    agent_key: bytes            # 32 bytes, derived from agent_address
    agent_id: int
    agent_count: int
    nullifier: int = 0          # Human's nullifier (for rate limiting by human identity)
    credentials: AgentCredentials | None = None
    error: str | None = None
    retry_after_ms: int | None = None  # Only set when rate limited
