"use client";

import { useState, useEffect, useRef, useCallback } from "react";

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [qrData, setQrData] = useState<any>(null);
  const [deepLink, setDeepLink] = useState<string | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const guardianInFlightRef = useRef<GuardianMethod>(null);

  // ── 1. Guardian auth ───────────────────────────────────────────────────
  const handleGuardianMethodChange = useCallback(
    async (method: "passkey" | "social" | "wallet") => {
      // Prevent duplicate triggers
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
          // Address will be set via the Privy effect below
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
    [network, privy, reg],
  );

  // Privy wallet effect: when authenticated and wallets arrive, set guardian address
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
  }, [
    reg.guardianMethod,
    privy.authenticated,
    privy.wallets,
    reg.guardianAddress,
    reg,
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
  }, [
    reg.hasEd25519,
    reg.ed25519Pubkey,
    reg.challengeHash,
    reg.guardianAddress,
    networkId,
    reg,
  ]);

  // ── 3. Session creation ────────────────────────────────────────────────
  useEffect(() => {
    if (!reg.isReadyToRegister || reg.sessionToken || loading) return;

    const mode = reg.mode;
    if (!mode) return;

    let cancelled = false;
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

        if (reg.hasEd25519) {
          payload.ed25519Pubkey = reg.ed25519Pubkey;
          payload.ed25519Signature = reg.ed25519Signature;
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
          setLoading(false);
          return;
        }

        if (data.sessionToken) {
          reg.setSessionToken(data.sessionToken);
        }
        if (data.agentAddress) {
          reg.setAgentAddress(data.agentAddress);
        }
        if (data.qrData) {
          setQrData(data.qrData);
          reg.setQrState("live");
        }
        if (data.deepLink) {
          setDeepLink(data.deepLink);
        }

        // Save the agent private key if the server returned one
        if (data.agentPrivateKey && data.agentAddress) {
          try {
            saveAgentPrivateKey({
              agentAddress: data.agentAddress,
              privateKey: data.agentPrivateKey,
              guardianAddress: reg.guardianAddress ?? undefined,
            });
          } catch {
            // Non-fatal — key export is available via the export endpoint
          }
        }
      } catch (err) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Session creation failed: ${msg}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void createSession();
    return () => {
      cancelled = true;
    };
  }, [
    reg.isReadyToRegister,
    reg.sessionToken,
    reg.mode,
    loading,
    networkId,
    reg,
  ]);

  // ── 4. Status polling ──────────────────────────────────────────────────
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
          if (data.agentId != null) {
            reg.setAgentId(String(data.agentId));
          }
          // Update session token if the server rotated it
          if (data.sessionToken) {
            reg.setSessionToken(data.sessionToken);
          }
        } else if (data.stage === "failed") {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setError(data.error ?? "Registration failed on-chain");
          reg.setQrState("hidden");
        }
      } catch {
        // Transient network error — keep polling
      }
    };

    pollingRef.current = setInterval(() => void poll(), 4000);
    // Also fire immediately
    void poll();

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [reg.qrState, reg.sessionToken, reg]);

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

          <FrameworkSection
            framework={reg.framework}
            ed25519Pubkey={reg.ed25519Pubkey}
            ed25519Signature={reg.ed25519Signature}
            challengeHash={reg.challengeHash}
            hasEd25519={reg.hasEd25519}
            onFrameworkChange={reg.setFramework}
            onPubkeyChange={reg.setEd25519Pubkey}
            onSignatureChange={reg.setEd25519Signature}
          />

          <GuardianSection
            wantsGuardian={reg.wantsGuardian}
            guardianMethod={reg.guardianMethod}
            onWantsGuardianChange={reg.setWantsGuardian}
            onGuardianMethodChange={(method) =>
              void handleGuardianMethodChange(method)
            }
          />

          {reg.guardianAddress && (
            <p className="text-xs text-muted font-mono break-all">
              Guardian: {reg.guardianAddress}
            </p>
          )}

          <DisclosuresSection
            disclosures={reg.disclosures}
            onUpdate={reg.updateDisclosure}
          />

          {loading && (
            <p className="text-sm text-muted animate-pulse">
              Preparing registration...
            </p>
          )}
        </div>

        {/* Right column: AskMyAgent or QRPanel */}
        <div className="order-first lg:order-last pl-0 lg:pl-10 mb-10 lg:mb-0">
          {reg.hasInteracted ? (
            <QRPanel
              qrState={reg.qrState}
              qrData={qrData}
              agentId={reg.agentId}
              agentAddress={reg.agentAddress}
              deepLink={deepLink}
              onSuccess={() => {
                // QR component callback — polling handles actual state update
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
