"use client";

import { useState, useMemo, useCallback } from "react";

export type GuardianMethod = "passkey" | "social" | "wallet" | null;

export type AgentFramework = string | null;

// Frameworks known to natively use Ed25519 keys
export const ED25519_FRAMEWORKS = new Set(["eliza", "coinbase-agentkit"]);

export type RegistrationMode =
  | "ed25519"
  | "ed25519-linked"
  | "linked"
  | "wallet-free"
  | "smartwallet";

export type QRState =
  | "hidden"
  | "placeholder"
  | "live"
  | "scanning"
  | "success";

export interface Disclosures {
  minimumAge: 0 | 18 | 21;
  ofac: boolean;
  nationality: boolean;
  name: boolean;
  date_of_birth: boolean;
  gender: boolean;
  issuing_state: boolean;
}

const DEFAULT_DISCLOSURES: Disclosures = {
  minimumAge: 0,
  ofac: false,
  nationality: false,
  name: false,
  date_of_birth: false,
  gender: false,
  issuing_state: false,
};

export function useRegistrationState() {
  const [wantsGuardian, setWantsGuardian] = useState<boolean | null>(false);
  const [guardianMethod, setGuardianMethod] = useState<GuardianMethod>(null);
  const [guardianAddress, setGuardianAddress] = useState<string | null>(null);
  const [framework, setFramework] = useState<AgentFramework>("openclaw");
  const [ed25519Pubkey, setEd25519Pubkey] = useState("");
  const [ed25519Signature, setEd25519Signature] = useState("");
  const [challengeHash, setChallengeHash] = useState<string | null>(null);
  const [disclosures, setDisclosures] =
    useState<Disclosures>(DEFAULT_DISCLOSURES);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [agentAddress, setAgentAddress] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [qrState, setQrState] = useState<QRState>("hidden");

  const hasEd25519 = useMemo(() => {
    if (framework && ED25519_FRAMEWORKS.has(framework)) return true;
    // Any valid 64-char pubkey triggers ed25519 mode (e.g. OpenClaw default flow)
    if (ed25519Pubkey.length === 64) return true;
    return false;
  }, [framework, ed25519Pubkey]);

  // Mode derivation from user choices:
  // Guardian? | Ed25519? | Mode
  // Yes (passkey) | Yes | ed25519-linked
  // Yes (passkey) | No  | smartwallet
  // Yes (social)  | Yes | ed25519-linked
  // Yes (social)  | No  | linked
  // Yes (wallet)  | Yes | ed25519-linked
  // Yes (wallet)  | No  | linked
  // No            | Yes | ed25519
  // No            | No  | wallet-free
  const mode = useMemo((): RegistrationMode | null => {
    if (wantsGuardian === null || framework === null) return null;

    if (wantsGuardian && hasEd25519) return "ed25519-linked";
    if (wantsGuardian && !hasEd25519) {
      if (guardianMethod === "passkey") return "smartwallet";
      return "linked";
    }
    if (!wantsGuardian && hasEd25519) return "ed25519";
    return "wallet-free";
  }, [wantsGuardian, hasEd25519, guardianMethod, framework]);

  // Only count as "interacted" once non-default choices are made
  // (defaults are ed25519 + no guardian, so right side shows AskMyAgent initially)
  const hasInteracted = useMemo(
    () =>
      ed25519Pubkey.length > 0 ||
      wantsGuardian === true ||
      (framework !== null && framework !== "openclaw"),
    [ed25519Pubkey, wantsGuardian, framework],
  );

  const isReadyToRegister = useMemo(() => {
    if (mode === null) return false;
    if (wantsGuardian && !guardianAddress) return false;
    // For ed25519 modes, the agent handles signing via the API directly —
    // the frontend only needs the pubkey (signature not collected in the form)
    if (hasEd25519 && ed25519Pubkey.length !== 64) return false;
    // For non-ed25519 modes, no additional key input needed
    return true;
  }, [mode, wantsGuardian, guardianAddress, hasEd25519, ed25519Pubkey]);

  const updateDisclosure = useCallback(
    <K extends keyof Disclosures>(key: K, value: Disclosures[K]) => {
      setDisclosures((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const reset = useCallback(() => {
    setWantsGuardian(null);
    setGuardianMethod(null);
    setGuardianAddress(null);
    setFramework(null);
    setEd25519Pubkey("");
    setEd25519Signature("");
    setChallengeHash(null);
    setDisclosures(DEFAULT_DISCLOSURES);
    setSessionToken(null);
    setAgentAddress(null);
    setAgentId(null);
    setQrState("hidden");
  }, []);

  return {
    // State
    wantsGuardian,
    guardianMethod,
    guardianAddress,
    framework,
    ed25519Pubkey,
    ed25519Signature,
    challengeHash,
    disclosures,
    sessionToken,
    agentAddress,
    agentId,
    qrState,
    // Derived
    hasEd25519,
    mode,
    isReadyToRegister,
    hasInteracted,
    // Setters
    setWantsGuardian,
    setGuardianMethod,
    setGuardianAddress,
    setFramework,
    setEd25519Pubkey,
    setEd25519Signature,
    setChallengeHash,
    updateDisclosure,
    setSessionToken,
    setAgentAddress,
    setAgentId,
    setQrState,
    reset,
  };
}
