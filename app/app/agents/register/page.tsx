"use client";

import type { SelfApp } from "@selfxyz/qrcode";
import { useState, useEffect, useRef, useCallback } from "react";
import { Copy, Check, CheckCircle, Terminal } from "lucide-react";

import { useNetwork } from "@/lib/NetworkContext";
import { usePrivyState } from "@/lib/privy";
import { isPasskeySupported, createPasskeyWallet } from "@/lib/aa";
import { connectWallet } from "@/lib/wallet";
import { savePasskey } from "@/lib/passkey-storage";
import { saveAgentPrivateKey } from "@/lib/agentKeyVault";

import { useRegistrationState } from "./hooks/useRegistrationState";
import type { GuardianMethod } from "./hooks/useRegistrationState";
import { GuardianSection } from "./components/GuardianSection";
import { FrameworkSection } from "./components/FrameworkSection";
import { DisclosuresSection } from "./components/DisclosuresSection";
import { AskMyAgent } from "./components/AskMyAgent";
import { QRPanel } from "./components/QRPanel";

export default function RegisterPage() {
  const { network, networkId } = useNetwork();
  const privy = usePrivyState();
  const reg = useRegistrationState();

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [qrData, setQrData] = useState<SelfApp | null>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [registrationComplete, setRegistrationComplete] = useState(false);
  const [showNoKeyOptions, setShowNoKeyOptions] = useState(false);
  const [noEd25519, setNoEd25519] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const relayPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const registryPollingRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const guardianInFlightRef = useRef<GuardianMethod>(null);
  const sessionCreatingRef = useRef(false);

  const copyText = (text: string, setter: (v: boolean) => void) => {
    void navigator.clipboard.writeText(text);
    setter(true);
    setTimeout(() => setter(false), 2000);
  };

  // ── 1. Guardian auth ───────────────────────────────────────────────────
  const handleGuardianMethodChange = useCallback(
    async (method: "passkey" | "social" | "wallet") => {
      if (guardianInFlightRef.current === method) return;
      guardianInFlightRef.current = method;

      setError(null);
      reg.setGuardianMethod(method);

      try {
        if (method === "passkey") {
          if (!isPasskeySupported()) {
            setError("Passkeys are not supported on this device.");
            guardianInFlightRef.current = null;
            return;
          }
          const suffix = crypto
            .getRandomValues(new Uint8Array(2))
            .reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
          const result = await createPasskeyWallet(
            `Self Agent Guardian ${suffix}`,
            network,
          );
          reg.setGuardianAddress(result.walletAddress);
          if (result.credentialId) {
            savePasskey({
              credentialId: result.credentialId,
              walletAddress: result.walletAddress,
              createdAt: Date.now(),
            });
          }
        } else if (method === "social") {
          if (!privy.login) {
            setError(
              "Social login is not configured. Set NEXT_PUBLIC_PRIVY_APP_ID.",
            );
            guardianInFlightRef.current = null;
            return;
          }
          privy.login();
        } else if (method === "wallet") {
          const address = await connectWallet(network);
          if (address) {
            reg.setGuardianAddress(address);
          } else {
            setError("Wallet connection cancelled or failed.");
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Guardian setup failed: ${msg}`);
      } finally {
        guardianInFlightRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [network, privy],
  );

  // Privy wallet effect
  useEffect(() => {
    if (
      reg.guardianMethod === "social" &&
      privy.authenticated &&
      privy.wallets.length > 0 &&
      !reg.guardianAddress
    ) {
      const embedded = privy.wallets.find(
        (w) => w.walletClientType === "privy",
      );
      const addr = embedded?.address ?? privy.wallets[0]?.address;
      if (addr) {
        reg.setGuardianAddress(addr);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reg.guardianMethod,
    privy.authenticated,
    privy.wallets,
    reg.guardianAddress,
  ]);

  // ── 2. Ed25519 challenge ───────────────────────────────────────────────
  useEffect(() => {
    if (
      !reg.hasEd25519 ||
      reg.ed25519Pubkey.length !== 64 ||
      reg.challengeHash
    ) {
      return;
    }

    let cancelled = false;

    const fetchChallenge = async () => {
      try {
        const body: Record<string, string> = {
          pubkey: reg.ed25519Pubkey,
          network: networkId === "celo-mainnet" ? "mainnet" : "testnet",
        };
        if (reg.guardianAddress) {
          body.humanAddress = reg.guardianAddress;
        }

        const res = await fetch("/api/agent/register/ed25519-challenge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!cancelled) {
          const data = (await res.json()) as {
            challengeHash?: string;
            error?: string;
          };
          if (!res.ok) {
            setError(data.error ?? "Failed to fetch Ed25519 challenge");
            return;
          }
          if (data.challengeHash) {
            reg.setChallengeHash(data.challengeHash);
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Ed25519 challenge failed: ${msg}`);
        }
      }
    };

    void fetchChallenge();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reg.hasEd25519,
    reg.ed25519Pubkey,
    reg.challengeHash,
    reg.guardianAddress,
    networkId,
  ]);

  // ── 2b. Reset session when form inputs change ─────────────────────────
  const settingsKey = JSON.stringify({
    mode: reg.mode,
    d: reg.disclosures,
    g: reg.guardianAddress,
    n: networkId,
  });

  useEffect(() => {
    if (!reg.sessionToken) return;
    reg.setSessionToken(null);
    reg.setQrState("hidden");
    setQrData(null);
    setDeepLink(null);
    sessionCreatingRef.current = false;
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingsKey]);

  // ── 3. Session creation (non-ed25519 modes only) ─────────────────────
  useEffect(() => {
    if (
      !reg.isReadyToRegister ||
      !reg.hasInteracted ||
      reg.sessionToken ||
      sessionCreatingRef.current ||
      reg.hasEd25519
    )
      return;

    const mode = reg.mode;
    if (!mode) return;

    let cancelled = false;
    sessionCreatingRef.current = true;
    setLoading(true);
    setError(null);

    const createSession = async () => {
      try {
        const apiNetwork = networkId === "celo-mainnet" ? "mainnet" : "testnet";

        const payload: Record<string, unknown> = {
          mode,
          network: apiNetwork,
          disclosures: {
            minimumAge: reg.disclosures.minimumAge,
            ofac: reg.disclosures.ofac,
            nationality: reg.disclosures.nationality,
            name: reg.disclosures.name,
            date_of_birth: reg.disclosures.date_of_birth,
            gender: reg.disclosures.gender,
            issuing_state: reg.disclosures.issuing_state,
          },
        };

        if (reg.guardianAddress) {
          payload.humanAddress = reg.guardianAddress;
        }

        const res = await fetch("/api/agent/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (cancelled) return;

        const data = (await res.json()) as {
          sessionToken?: string;
          agentAddress?: string;
          qrData?: unknown;
          deepLink?: string;
          error?: string;
          agentPrivateKey?: string;
        };

        if (!res.ok) {
          setError(data.error ?? "Registration failed");
          return;
        }

        if (data.sessionToken) reg.setSessionToken(data.sessionToken);
        if (data.agentAddress) reg.setAgentAddress(data.agentAddress);
        if (data.qrData) {
          setQrData(data.qrData as SelfApp);
          reg.setQrState("live");
        }
        if (data.deepLink) setDeepLink(data.deepLink);

        if (data.agentPrivateKey && data.agentAddress) {
          try {
            saveAgentPrivateKey({
              agentAddress: data.agentAddress,
              privateKey: data.agentPrivateKey,
              guardianAddress: reg.guardianAddress ?? undefined,
            });
          } catch {
            // Non-fatal
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Session creation failed: ${msg}`);
        }
      } finally {
        if (!cancelled) {
          sessionCreatingRef.current = false;
          setLoading(false);
        }
      }
    };

    void createSession();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reg.isReadyToRegister,
    reg.hasInteracted,
    reg.sessionToken,
    reg.mode,
    reg.hasEd25519,
    networkId,
  ]);

  // ── 4a. Status polling (non-ed25519 — session token based) ───────────
  useEffect(() => {
    if (
      (reg.qrState !== "live" && reg.qrState !== "scanning") ||
      !reg.sessionToken
    ) {
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/agent/register/status?token=${encodeURIComponent(reg.sessionToken!)}`,
        );
        const data = (await res.json()) as {
          stage?: string;
          agentId?: number;
          sessionToken?: string;
          error?: string;
        };

        if (data.stage === "completed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          reg.setQrState("success");
          if (data.agentId != null) reg.setAgentId(String(data.agentId));
          if (data.sessionToken) reg.setSessionToken(data.sessionToken);
        } else if (data.stage === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setError(data.error ?? "Registration failed on-chain");
          reg.setQrState("hidden");
        }
      } catch {
        // Transient — keep polling
      }
    };

    pollingRef.current = setInterval(() => void poll(), 4000);
    void poll();

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg.qrState, reg.sessionToken]);

  // ── 4b. Ed25519 relay polling ─────────────────────────────────────────
  // After the user enters a pubkey + challenge is shown, poll the relay
  // endpoint to pick up QR data once the agent calls the register API.
  useEffect(() => {
    if (
      !reg.hasEd25519 ||
      reg.ed25519Pubkey.length !== 64 ||
      !reg.challengeHash ||
      reg.sessionToken || // Already have QR data
      registrationComplete
    ) {
      return;
    }

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/agent/register/ed25519-poll?pubkey=${encodeURIComponent(reg.ed25519Pubkey)}`,
        );
        const data = (await res.json()) as {
          ready?: boolean;
          qrData?: unknown;
          deepLink?: string;
          sessionToken?: string;
          agentAddress?: string;
        };

        if (data.ready && data.sessionToken) {
          if (relayPollingRef.current) clearInterval(relayPollingRef.current);
          reg.setSessionToken(data.sessionToken);
          if (data.agentAddress) reg.setAgentAddress(data.agentAddress);
          if (data.qrData) {
            setQrData(data.qrData as SelfApp);
            reg.setQrState("live");
          }
          if (data.deepLink) setDeepLink(data.deepLink);
        }
      } catch {
        // Transient — keep polling
      }
    };

    relayPollingRef.current = setInterval(() => void poll(), 3000);
    void poll();

    return () => {
      if (relayPollingRef.current) {
        clearInterval(relayPollingRef.current);
        relayPollingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    reg.hasEd25519,
    reg.ed25519Pubkey,
    reg.challengeHash,
    reg.sessionToken,
    registrationComplete,
  ]);

  // ── 4c. Registry polling (ed25519 — check on-chain via API) ───────────
  useEffect(() => {
    if (
      !reg.hasEd25519 ||
      reg.ed25519Pubkey.length !== 64 ||
      registrationComplete
    ) {
      return;
    }

    const apiNetwork = networkId === "celo-mainnet" ? "mainnet" : "testnet";

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/agent/register/ed25519-check?pubkey=${encodeURIComponent(reg.ed25519Pubkey)}&network=${apiNetwork}`,
        );
        const data = (await res.json()) as {
          registered?: boolean;
          agentId?: string;
          agentAddress?: string;
        };

        if (data.registered) {
          if (registryPollingRef.current)
            clearInterval(registryPollingRef.current);
          if (data.agentAddress) reg.setAgentAddress(data.agentAddress);
          if (data.agentId) reg.setAgentId(data.agentId);
          reg.setQrState("success");
          setRegistrationComplete(true);
        }
      } catch {
        // Transient — keep polling
      }
    };

    registryPollingRef.current = setInterval(() => void poll(), 5000);
    void poll();

    return () => {
      if (registryPollingRef.current) {
        clearInterval(registryPollingRef.current);
        registryPollingRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reg.hasEd25519, reg.ed25519Pubkey, registrationComplete, networkId]);

  // ── Derived state ──────────────────────────────────────────────────────
  const _isEd25519Flow = reg.hasEd25519 && !showNoKeyOptions;
  const showQrPanel =
    reg.qrState === "live" ||
    reg.qrState === "scanning" ||
    reg.qrState === "success" ||
    reg.qrState === "placeholder";

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl px-6 py-12">
      <h1 className="text-2xl font-bold text-foreground text-center mb-10">
        Register your agent
      </h1>

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/30 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        {/* Left column: manual form */}
        <div className="space-y-10 pr-0 lg:pr-10 lg:border-r lg:border-border">
          <h2 className="text-xl font-semibold text-foreground">
            Do it manually
          </h2>

          {/* ── Public key input ── */}
          {!showNoKeyOptions && (
            <section className="space-y-4">
              <h3 className="text-lg font-semibold text-foreground">
                Your agent&apos;s public key
              </h3>
              <p className="text-sm text-muted">
                Paste your agent&apos;s Ed25519 public key. Your agent will
                handle the signing and passport scan via the API.
              </p>

              <div className="space-y-3 rounded-xl border border-border bg-surface-1 p-4">
                <div>
                  <label className="block text-sm text-muted mb-1">
                    Ed25519 public key (64 hex chars)
                  </label>
                  <input
                    type="text"
                    maxLength={64}
                    placeholder="e.g. a1b2c3d4..."
                    value={reg.ed25519Pubkey}
                    onChange={(e) => reg.setEd25519Pubkey(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono rounded-lg"
                  />
                </div>

                {reg.challengeHash && (
                  <div>
                    <label className="block text-sm text-muted mb-1">
                      Challenge hash (give this to your agent)
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        readOnly
                        value={reg.challengeHash}
                        className="w-full px-3 py-2 pr-10 text-sm font-mono rounded-lg bg-surface-2 cursor-default"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          copyText(reg.challengeHash!, setCopiedHash)
                        }
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors"
                        title="Copy hash"
                      >
                        {copiedHash ? (
                          <Check className="h-4 w-4 text-accent-success" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {reg.challengeHash && !showQrPanel && !registrationComplete && (
                <p className="text-sm text-muted animate-pulse">
                  Waiting for your agent to sign and register...
                </p>
              )}

              {registrationComplete && (
                <div className="flex items-center gap-2 text-sm text-accent-success font-medium">
                  <CheckCircle className="h-4 w-4" />
                  Agent registered on-chain
                  {reg.agentId && <span>(ID: {reg.agentId})</span>}
                </div>
              )}
            </section>
          )}

          {/* ── "Don't have your public key?" ── */}
          <section className="space-y-3">
            <button
              type="button"
              onClick={() => {
                const opening = !showNoKeyOptions;
                setShowNoKeyOptions(opening);
                if (opening) {
                  // Switching to no-key mode — clear state, no framework selected
                  reg.setFramework(null);
                  reg.setEd25519Pubkey("");
                  reg.setChallengeHash(null);
                } else {
                  // Switching back to "I have my key" — reset no-ed25519
                  // and clear any QR / session from the non-ed25519 flow
                  setNoEd25519(false);
                  reg.setFramework("openclaw");
                  reg.setSessionToken(null);
                  reg.setQrState("hidden");
                  setQrData(null);
                  setDeepLink(null);
                }
              }}
              className="text-sm font-medium text-accent hover:underline"
            >
              {showNoKeyOptions
                ? "I have my agent\u2019s public key"
                : "Don\u2019t have your public key?"}
            </button>

            {showNoKeyOptions && (
              <div className="space-y-4 rounded-xl border border-border bg-surface-1 p-4">
                {/* Ask your agent prompt */}
                <div>
                  <p className="text-sm text-muted">
                    Most agent frameworks (OpenClaw, Eliza, Coinbase AgentKit,
                    etc.) generate an Ed25519 key for your agent. If you are not
                    sure what your agent&apos;s public key is, you can{" "}
                    <strong className="text-foreground">
                      ask your agent this question
                    </strong>
                    :
                  </p>

                  <div className="relative mt-3 rounded-lg border border-border overflow-hidden">
                    <div
                      className="flex items-center justify-between px-4 py-2 border-b border-border"
                      style={{ backgroundColor: "#1e1e2e" }}
                    >
                      <span className="text-xs text-gray-400 font-mono flex items-center gap-1.5">
                        <Terminal className="h-3 w-3" />
                        Prompt
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(
                            "Check if you have an Ed25519 keypair available. If you do, give me the public key (64 hex chars, no 0x prefix). If not, tell me what key types you support.",
                            setCopiedPrompt,
                          )
                        }
                        className="text-xs text-gray-400 hover:text-gray-200 transition-colors flex items-center gap-1"
                      >
                        {copiedPrompt ? (
                          <>
                            <Check className="h-3 w-3" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                    <pre
                      className="p-4 overflow-x-auto text-sm font-mono leading-relaxed text-gray-200 whitespace-pre-wrap"
                      style={{ backgroundColor: "#1e1e2e", margin: 0 }}
                    >
                      Check if you have an Ed25519 keypair available. If you do,
                      give me the public key (64 hex chars, no 0x prefix). If
                      not, tell me what key types you support.
                    </pre>
                  </div>
                </div>

                {/* No Ed25519 option */}
                <div className="border-t border-border pt-4 space-y-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (noEd25519) {
                        // Untoggle — clear selection
                        setNoEd25519(false);
                        reg.setFramework(null);
                        reg.setEd25519Pubkey("");
                        reg.setSessionToken(null);
                        reg.setQrState("hidden");
                        setQrData(null);
                        setDeepLink(null);
                      } else {
                        // Toggle on — deselect any framework
                        setNoEd25519(true);
                        reg.setFramework("manual");
                        reg.setEd25519Pubkey("");
                        reg.setSessionToken(null);
                        reg.setQrState("hidden");
                        setQrData(null);
                        setDeepLink(null);
                      }
                    }}
                    className={`w-full text-left rounded-lg border px-4 py-3 transition-all text-sm ${
                      noEd25519
                        ? "border-accent bg-accent/10 text-accent font-medium"
                        : "border-border hover:border-border-strong bg-surface-2 text-foreground"
                    }`}
                  >
                    My agent doesn&apos;t use Ed25519
                  </button>

                  <p className="text-sm text-muted">
                    Not sure? Select your framework below:
                  </p>
                  <FrameworkSection
                    framework={noEd25519 ? null : reg.framework}
                    ed25519Pubkey={reg.ed25519Pubkey}
                    ed25519Signature={reg.ed25519Signature}
                    challengeHash={reg.challengeHash}
                    hasEd25519={reg.hasEd25519}
                    onFrameworkChange={(fw) => {
                      // Selecting a framework deselects "no ed25519"
                      setNoEd25519(false);
                      reg.setFramework(fw);
                    }}
                    onPubkeyChange={reg.setEd25519Pubkey}
                    onSignatureChange={reg.setEd25519Signature}
                  />
                </div>
              </div>
            )}
          </section>

          <GuardianSection
            wantsGuardian={reg.wantsGuardian}
            guardianMethod={reg.guardianMethod}
            onWantsGuardianChange={reg.setWantsGuardian}
            onGuardianMethodChange={(method) =>
              void handleGuardianMethodChange(method)
            }
          />

          <DisclosuresSection
            disclosures={reg.disclosures}
            onUpdate={reg.updateDisclosure}
          />

          {reg.guardianAddress && (
            <p className="text-xs text-muted font-mono break-all">
              Guardian: {reg.guardianAddress}
            </p>
          )}

          {loading && (
            <p className="text-sm text-muted animate-pulse">
              Preparing registration...
            </p>
          )}
        </div>

        {/* Right column */}
        <div className="order-first lg:order-last pl-0 lg:pl-10 mb-10 lg:mb-0">
          {registrationComplete ? (
            <div className="text-center space-y-4 py-12">
              <CheckCircle className="h-16 w-16 text-accent-success mx-auto" />
              <h2 className="text-xl font-bold text-foreground">
                Registration complete
              </h2>
              {reg.agentId && (
                <p className="text-sm text-muted">Agent ID: {reg.agentId}</p>
              )}
              {reg.agentAddress && (
                <p className="text-xs text-muted font-mono break-all">
                  {reg.agentAddress}
                </p>
              )}
            </div>
          ) : showQrPanel ? (
            <QRPanel
              qrState={reg.qrState}
              qrData={qrData}
              agentId={reg.agentId}
              agentAddress={reg.agentAddress}
              deepLink={deepLink}
              onSuccess={() => {
                if (reg.qrState === "live") {
                  reg.setQrState("scanning");
                }
              }}
              onError={(data) => {
                setError(
                  data.reason ??
                    data.error_code ??
                    "QR verification encountered an error",
                );
              }}
            />
          ) : (
            <AskMyAgent />
          )}
        </div>
      </div>
    </div>
  );
}
