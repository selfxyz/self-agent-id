# Changelog

## 0.3.0

### Breaking changes

- `RegistrationMode` is now `linked | wallet-free | ed25519 | ed25519-linked | privy | smartwallet`; `"self-custody"` is gone.
- `RegistrationRequest` no longer has `agentName` / `agentDescription` (the API never used them).
- `RegistrationResult.txHash` removed. `RefreshSession.waitForCompletion()` resolves `proofExpiresAt` as optional (it is left unset rather than invented when the API doesn't return one).
- `ApiAgentInfo.registeredAt` is now `registeredAtBlock` (a block number, not a timestamp); `credentials` fields are non-optional, and `hasHumanProof`, `isProofFresh` and `proofExpiresAt` (ISO string or `null`) were added. `ApiAgentsForHuman` gains `isOwner`, `isAgentKey`, proof fields, `ownedCount` and `complete`.
- A2A types follow A2A v0.3: parts use `kind` instead of `type`, `Message` has `kind` / `messageId`, `Task.sessionId` is now `contextId`, `Artifact` has `artifactId` (no `index` / `append` / `lastChunk`; those moved to `TaskArtifactUpdateEvent`), and stream events carry `kind`, `taskId` and `contextId`. The client still tags legacy `type` parts with `kind`.
- `AgentInfo.isVerified` (and verification everywhere) now means `hasHumanProof && isProofFresh`; `hasHumanProof` is exposed separately.
- `verifier.auth()` no longer re-serialises a parsed `req.body`. Keep the raw body (`req.rawBody`, or a string/Buffer `req.body`); a request with a body but no raw body gets a 500 and a console error explaining the fix.
- `SelfAgent.setAgentCard()` throws before sending a transaction unless the agent key owns the agent NFT (true only for wallet-free agents).
- CLI: only `linked` and `wallet-free` are supported by `self-agent register|deregister`; the smartwallet handoff and local callback server are gone. Use `requestRegistration()` for other modes.

### Fixes

- `verifyAgent(agentKey, { network })` works like the rest of the SDK (registry, chain ID and RPC derived from the network); `{ chainId, registryAddress }` remain as overrides. `CHAIN_IDS` is exported.

- `AgentInfo.daysUntilExpiry` is `null` (not `-1`) when no expiry is set, so `-1` only ever means "expired less than a day ago". `A2AServer` answers unreadable requests with JSON-RPC `id: null`.

- Session status polling sends the token as `Authorization: Bearer` and follows the rotated token on every poll; `exportKey()` uses the latest rotated token.
- Session-start responses expose `scanUrl` (a QR image URL safe to show the human).
- Docs: `ed25519` / `ed25519-linked` registration takes `ed25519Pubkey` / `ed25519Signature` (no key to export); the README mode table was corrected.
- `SelfAgent#requestDeregistration()` accepts and forwards `disclosures` (should match the original registration).
- `RegistrationError` carries the HTTP `status` (e.g. 404 for a nonexistent agent).
- `AgentInfo.isExpiringSoon` and `VerificationResult.isExpiringSoon` use `isProofExpiringSoon` (not expired, under 30 days), so a just-expired proof no longer counts as "expiring soon".
- `SelfAgent.fetch` / `Ed25519Agent.fetch` default string bodies to `Content-Type: application/json` and accept `Headers` instances.
- `A2AClient` surfaces the server's JSON-RPC error (code, message, `data.retryAfterMs`) even when it arrives with a 4xx status, instead of a generic `HTTP <status>` error.
- `req.agent` set by `verifier.auth()` is typed (`VerifiedAgent`, merged into Express's `Request`).
- New exports: `computeSigningMessage`, `RegistrationDisclosureRequest`, `VerifiedAgent`.
- The Ed25519 tests now run in CI and are no longer published in `dist`.
- `verifier.auth()` catches errors thrown by `verify()` (e.g. an RPC failure) and responds 503 `{ error }` (logged) instead of leaving the request hanging.
- `A2AClient.sendMessageStream` uses a line-buffered SSE parser: events split across chunks, a final event without a blank line, `\r\n` / `\r` line endings and `data:` without a space all work.
- `A2AServer`: the `message/stream` error no longer points at a nonexistent `handleStreamRequest()`; the task store is bounded (`maxStoredTasks`, default 1000, oldest evicted); a non-object request returns `INVALID_REQUEST` instead of `PARSE_ERROR`.
- `SelfAgent.toAgentCardDataURI()` encodes the card as UTF-8 (no longer throws on non-Latin-1 text such as Unicode names).
- `Ed25519Agent` rejects private keys containing non-hex characters (previously decoded as zero bytes).
- `AgentInfo.daysUntilExpiry` rounds down (`Math.floor`) like `VerificationResult.daysUntilExpiry`, e.g. a proof expired by hours is `-1`, not `0`.
- `verifyAgent()` uses the registry's `isProofFresh` instead of comparing `proofExpiresAt` with the local clock (an unset expiry is now `PROOF_EXPIRED`, as on-chain).
- Card builders agree: the auto-added A2A service `version` is the A2A protocol version (`A2A_PROTOCOL_VERSION`, "0.3.0") in both, `buildAgentCard` auto-generates missing skill IDs, and `trustModel.sybilResistant` is the agent's `hasHumanProof` (was always `true`).
- Unsupported `minimumAge` values (anything but 0, 18, 21) now throw in `getRegistrationConfigIndex` and the `userData` builders instead of silently dropping the age gate.
- `VerifierBuilder.requireSelfProvider(enabled = true)` can now turn the check off.
- CLI `wait` reports a timeout distinctly (exit code 2, session stage unchanged, each poll bounded by the deadline) instead of marking the session expired; help and README note the CLI defaults to testnet while the SDK defaults to mainnet.
